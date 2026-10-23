/**
 * Web-standard HTTP entrypoint (Request → Response), shared by Vercel and any
 * other fetch-style runtime (Cloudflare Workers, Deno, Bun, Netlify).
 *
 * Personal health data is behind this endpoint, so it fails closed: without a
 * configured MCP_AUTH_TOKEN every request is refused. Clients authenticate with
 * `Authorization: Bearer <MCP_AUTH_TOKEN>`, or, when MCP_OAUTH_CLIENT_ID and
 * MCP_OAUTH_CLIENT_SECRET are set, with an access token from the built-in OAuth flow.
 */
import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import { ConfigError, loadGarminConfig, processEnv } from './config.js';
import { SERVER_NAME, createGarminServer, createToolContext } from './mcp-server.js';
import { handleOAuth, isValidAccessToken, loadOAuthConfig, oauthRoute, resourceMetadataUrl, type OAuthConfig } from './oauth/routes.js';
import { secretsEqual } from './oauth/tokens.js';

/** Shorter shared secrets are refused: the token is the only thing protecting your data. */
export const MIN_AUTH_TOKEN_LENGTH = 24;

type Env = Record<string, string | undefined>;

export interface HttpHandlerOptions {
  env?: Env;
  /** Injected in tests to fake Garmin. */
  fetch?: typeof fetch;
  /** Injected in tests to control token expiry. */
  now?: () => number;
  /** Injected in tests to skip the delay after a wrong token on the OAuth login page. */
  oauthFailureDelayMs?: number;
}

/**
 * Build a request handler. Create it once per process (module scope) so the
 * Garmin access token stays cached across requests on warm instances.
 */
export function createHttpHandler(options: HttpHandlerOptions = {}): (request: Request) => Promise<Response> {
  const env = options.env ?? processEnv();
  const now = options.now ?? Date.now;
  let mcp: McpHttpHandler | undefined;
  let oauthLoading: Promise<OAuthConfig | undefined> | undefined;

  return async (request) => {
    const expected = env.MCP_AUTH_TOKEN?.trim();
    if (!expected || expected.length < MIN_AUTH_TOKEN_LENGTH) {
      return jsonError(
        500,
        `Server not configured: set MCP_AUTH_TOKEN to a random secret of at least ${MIN_AUTH_TOKEN_LENGTH} characters (e.g. \`openssl rand -base64 32\`).`,
      );
    }

    let oauth: OAuthConfig | undefined;
    try {
      oauthLoading ??= loadOAuthConfig(env, expected);
      oauth = await oauthLoading;
      if (oauth && options.oauthFailureDelayMs !== undefined) oauth.failureDelayMs = options.oauthFailureDelayMs;
    } catch (error) {
      oauthLoading = undefined;
      return jsonError(500, `Server not configured: ${error instanceof ConfigError ? error.message : 'invalid OAuth settings.'}`);
    }

    const url = new URL(request.url);
    const route = oauthRoute(url);
    if (route) {
      if (!oauth) {
        return jsonError(404, 'OAuth is not enabled on this server. Set MCP_OAUTH_CLIENT_ID and MCP_OAUTH_CLIENT_SECRET to enable it.');
      }
      return handleOAuth(request, route, oauth, now());
    }

    if (!(await isAuthorized(request, expected, oauth, now()))) {
      const challenge = oauth
        ? `Bearer realm="${SERVER_NAME}", resource_metadata="${resourceMetadataUrl(url)}"`
        : `Bearer realm="${SERVER_NAME}"`;
      const hint = oauth ? ' or sign in through OAuth' : '';
      return jsonError(401, `Missing or invalid bearer token. Send "Authorization: Bearer <MCP_AUTH_TOKEN>"${hint}.`, {
        'WWW-Authenticate': challenge,
      });
    }

    if (!mcp) {
      try {
        const ctx = createToolContext(loadGarminConfig(env), { fetch: options.fetch });
        mcp = createMcpHandler(() => createGarminServer(ctx), {
          onerror: (error) => console.error(`[${SERVER_NAME}] ${error.message}`),
        });
      } catch (error) {
        const message = error instanceof ConfigError ? error.message : 'Failed to start the MCP server.';
        return jsonError(500, `Server not configured: ${message}`);
      }
    }
    return mcp.fetch(request);
  };
}

/** The static MCP_AUTH_TOKEN (compared in constant time), or a valid OAuth access token. */
async function isAuthorized(request: Request, expected: string, oauth: OAuthConfig | undefined, nowMs: number): Promise<boolean> {
  const presented = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1]?.trim();
  if (!presented) return false;
  if (await secretsEqual(presented, expected)) return true;
  return oauth !== undefined && (await isValidAccessToken(presented, oauth, nowMs));
}

function jsonError(status: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
