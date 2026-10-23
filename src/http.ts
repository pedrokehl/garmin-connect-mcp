/**
 * Web-standard HTTP entrypoint (Request → Response), shared by Vercel and any
 * other fetch-style runtime (Cloudflare Workers, Deno, Bun, Netlify).
 *
 * Personal health data is behind this endpoint, so it fails closed: without a
 * configured MCP_AUTH_TOKEN every request is refused.
 */
import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import { ConfigError, loadGarminConfig, processEnv } from './config.js';
import { SERVER_NAME, createGarminServer, createToolContext } from './server.js';

/** Shorter shared secrets are refused: the token is the only thing protecting your data. */
export const MIN_AUTH_TOKEN_LENGTH = 24;

type Env = Record<string, string | undefined>;

export interface HttpHandlerOptions {
  env?: Env;
  /** Injected in tests to fake Garmin. */
  fetch?: typeof fetch;
}

/**
 * Build a request handler. Create it once per process (module scope) so the
 * Garmin access token stays cached across requests on warm instances.
 */
export function createHttpHandler(options: HttpHandlerOptions = {}): (request: Request) => Promise<Response> {
  const env = options.env ?? processEnv();
  let mcp: McpHttpHandler | undefined;

  return async (request) => {
    const expected = env.MCP_AUTH_TOKEN?.trim();
    if (!expected || expected.length < MIN_AUTH_TOKEN_LENGTH) {
      return jsonError(
        500,
        `Server not configured: set MCP_AUTH_TOKEN to a random secret of at least ${MIN_AUTH_TOKEN_LENGTH} characters (e.g. \`openssl rand -base64 32\`).`,
      );
    }
    if (!(await bearerMatches(request.headers.get('authorization'), expected))) {
      return jsonError(401, 'Missing or invalid bearer token. Send "Authorization: Bearer <MCP_AUTH_TOKEN>".', {
        'WWW-Authenticate': `Bearer realm="${SERVER_NAME}"`,
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

/** Constant-time comparison of the presented bearer token (hash both, compare digests). */
async function bearerMatches(header: string | null, expected: string): Promise<boolean> {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? '');
  if (!match?.[1]) return false;
  const [a, b] = await Promise.all([sha256(match[1].trim()), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

function jsonError(status: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
