import {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type OAuthClientProvider,
} from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';
import { createHttpHandler } from '../src/http.js';
import { pkceChallenge } from '../src/oauth/tokens.js';
import { BASE_URL, json, mockGarmin } from './helpers.js';

const ORIGIN = 'https://garmin-mcp.example.app';
const AUTH_TOKEN = 'static-auth-token-abcdefghijklmnop';
/** The default client ID: setup() sets only the secret, as most users will. */
const CLIENT_ID = 'garmin-mcp';
const CLIENT_SECRET = 'client-secret-0123456789abcdefghij';
const CLAUDE_CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const VERIFIER = 'a-pkce-code-verifier-that-is-long-enough-0123456789';

function setup(env: Record<string, string | undefined> = {}, nowRef = { now: Date.now() }) {
  const garmin = mockGarmin(() => json({ displayName: 'runner' }));
  const handle = createHttpHandler({
    env: {
      GARMIN_API_KEY: 'key',
      GARMIN_API_BASE_URL: BASE_URL,
      MCP_AUTH_TOKEN: AUTH_TOKEN,
      MCP_OAUTH_CLIENT_SECRET: CLIENT_SECRET,
      ...env,
    },
    fetch: garmin.fetch,
    now: () => nowRef.now,
    oauthFailureDelayMs: 0,
  });
  return { handle, garmin, nowRef };
}

function authorizeParams(overrides: Record<string, string | undefined> = {}): URLSearchParams {
  const params = new URLSearchParams();
  const values: Record<string, string | undefined> = {
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: CLAUDE_CALLBACK,
    state: 'xyz',
    scope: 'garmin:read',
    code_challenge_method: 'S256',
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) if (value !== undefined) params.set(key, value);
  return params;
}

async function signIn(handle: (r: Request) => Promise<Response>, params: URLSearchParams, token = AUTH_TOKEN) {
  const body = new URLSearchParams(params);
  body.set('server_secret', token);
  return handle(
    new Request(`${ORIGIN}/oauth/authorize`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    }),
  );
}

async function getCode(
  handle: (r: Request) => Promise<Response>,
  overrides: Record<string, string | undefined> = {},
  secret = AUTH_TOKEN,
) {
  const challenge = await pkceChallenge(VERIFIER);
  const response = await signIn(handle, authorizeParams({ code_challenge: challenge, ...overrides }), secret);
  expect(response.status).toBe(302);
  const location = new URL(response.headers.get('location')!);
  return { code: location.searchParams.get('code')!, location };
}

function tokenRequest(fields: Record<string, string>, basic = false): Request {
  const body = new URLSearchParams(fields);
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  if (basic) headers.authorization = `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`;
  else {
    body.set('client_id', CLIENT_ID);
    body.set('client_secret', CLIENT_SECRET);
  }
  return new Request(`${ORIGIN}/oauth/token`, { method: 'POST', headers, body });
}

async function exchange(handle: (r: Request) => Promise<Response>, code: string, extra: Record<string, string> = {}, basic = false) {
  const response = await handle(
    tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: CLAUDE_CALLBACK, code_verifier: VERIFIER, ...extra }, basic),
  );
  return { response, body: (await response.json()) as Record<string, unknown> };
}

const listTools = (bearer?: string) =>
  new Request(`${ORIGIN}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });

describe('OAuth configuration', () => {
  it('is off without a client secret: discovery 404s and bearer tokens still work', async () => {
    const { handle } = setup({ MCP_OAUTH_CLIENT_SECRET: undefined });
    expect((await handle(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`))).status).toBe(404);
    const unauthorized = await handle(listTools());
    expect(unauthorized.headers.get('www-authenticate')).toBe('Bearer realm="garmin-connect-mcp"');
    expect((await handle(listTools(AUTH_TOKEN))).status).toBe(200);
  });

  it('is on with only the secret set, using the default client ID "garmin-mcp"', async () => {
    const { handle } = setup();
    const page = await handle(new Request(`${ORIGIN}/oauth/authorize?${authorizeParams({ client_id: 'garmin-mcp' })}`));
    expect(page.status).toBe(200);
  });

  it('lets MCP_OAUTH_CLIENT_ID override the default', async () => {
    const { handle } = setup({ MCP_OAUTH_CLIENT_ID: 'my-own-id' });
    const custom = await handle(new Request(`${ORIGIN}/oauth/authorize?${authorizeParams({ client_id: 'my-own-id' })}`));
    expect(custom.status).toBe(200);
    const fallback = await handle(new Request(`${ORIGIN}/oauth/authorize?${authorizeParams({ client_id: 'garmin-mcp' })}`));
    expect(fallback.status).toBe(400);
    expect(await fallback.text()).toMatch(/client ID doesn&#39;t match/);
  });

  it('fails closed when a client ID is set without a secret', async () => {
    const { handle } = setup({ MCP_OAUTH_CLIENT_ID: 'my-own-id', MCP_OAUTH_CLIENT_SECRET: undefined });
    const response = await handle(listTools(AUTH_TOKEN));
    expect(response.status).toBe(500);
    expect(await response.text()).toMatch(/MCP_OAUTH_CLIENT_ID is set but MCP_OAUTH_CLIENT_SECRET is missing/);
  });

  it('refuses a short client secret', async () => {
    const { handle } = setup({ MCP_OAUTH_CLIENT_SECRET: 'short' });
    expect(await (await handle(listTools(AUTH_TOKEN))).text()).toMatch(/MCP_OAUTH_CLIENT_SECRET must be at least 24/);
  });

  it('rejects invalid extra redirect URIs', async () => {
    const { handle } = setup({ MCP_OAUTH_REDIRECT_URIS: 'not a url' });
    expect((await handle(listTools(AUTH_TOKEN))).status).toBe(500);
  });
});

describe('OAuth discovery', () => {
  it('points 401 responses at the protected-resource metadata for the requested path', async () => {
    const { handle } = setup();
    const response = await handle(listTools());
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe(
      `Bearer realm="garmin-connect-mcp", resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
    );
  });

  it('serves protected-resource metadata (also via the Vercel rewrite form)', async () => {
    const { handle } = setup();
    for (const url of [
      `${ORIGIN}/.well-known/oauth-protected-resource/mcp`,
      `${ORIGIN}/api/mcp?__route=/.well-known/oauth-protected-resource/mcp`,
    ]) {
      const metadata = await (await handle(new Request(url))).json();
      expect(metadata).toMatchObject({ resource: `${ORIGIN}/mcp`, authorization_servers: [ORIGIN], scopes_supported: ['garmin:read'] });
    }
    const forApiPath = await (await handle(new Request(`${ORIGIN}/.well-known/oauth-protected-resource/api/mcp`))).json();
    expect(forApiPath.resource).toBe(`${ORIGIN}/api/mcp`);
  });

  it('serves authorization-server metadata at the standard and OIDC paths', async () => {
    const { handle } = setup();
    for (const path of ['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration', '/api/mcp?__route=/.well-known/oauth-authorization-server']) {
      const response = await handle(new Request(`${ORIGIN}${path}`));
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(await response.json()).toMatchObject({
        issuer: ORIGIN,
        authorization_endpoint: `${ORIGIN}/oauth/authorize`,
        token_endpoint: `${ORIGIN}/oauth/token`,
        code_challenge_methods_supported: ['S256'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
      });
    }
  });
});

describe('/oauth/authorize', () => {
  it('shows a hardened login page with the request carried in hidden fields (escaped)', async () => {
    const { handle } = setup();
    const response = await handle(new Request(`${ORIGIN}/oauth/authorize?${authorizeParams({ state: '"><script>x</script>' })}`));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('name="server_secret"');
    expect(html).toContain('<code>MCP_AUTH_TOKEN</code>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
    expect(html).not.toContain('<script>x');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('content-security-policy')).toContain("form-action 'self' https://claude.ai");
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('does not redirect to an unknown redirect URI or for an unknown client', async () => {
    const { handle } = setup();
    const evil = await handle(new Request(`${ORIGIN}/oauth/authorize?${authorizeParams({ redirect_uri: 'https://evil.example/cb' })}`));
    expect(evil.status).toBe(400);
    expect(evil.headers.get('location')).toBeNull();
    expect(await evil.text()).toMatch(/MCP_OAUTH_REDIRECT_URIS/);

    const client = await handle(new Request(`${ORIGIN}/oauth/authorize?${authorizeParams({ client_id: 'someone-else' })}`));
    expect(client.status).toBe(400);
    expect(client.headers.get('location')).toBeNull();
  });

  it('allows extra redirect URIs from MCP_OAUTH_REDIRECT_URIS and loopback URIs', async () => {
    const { handle } = setup({ MCP_OAUTH_REDIRECT_URIS: 'https://gemini.example/cb, https://other.example/cb' });
    for (const uri of ['https://gemini.example/cb', 'http://localhost:6274/oauth/callback', 'http://127.0.0.1:9000/cb']) {
      const response = await handle(new Request(`${ORIGIN}/oauth/authorize?${authorizeParams({ redirect_uri: uri })}`));
      expect(response.status).toBe(200);
    }
  });

  const GEMINI_CALLBACK =
    'https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-100681915307080570228-garmin-connect-mcp-hq31m8as91h_vercel_app';

  it('allows Gemini app connector callbacks and ChatGPT by default, and completes the flow', async () => {
    const { handle } = setup();
    for (const uri of [GEMINI_CALLBACK, 'https://chatgpt.com/connector_platform_oauth_redirect']) {
      expect((await handle(new Request(`${ORIGIN}/oauth/authorize?${authorizeParams({ redirect_uri: uri })}`))).status).toBe(200);
    }
    const signedIn = await signIn(handle, authorizeParams({ redirect_uri: GEMINI_CALLBACK, code_challenge_method: undefined }));
    expect(signedIn.status).toBe(302);
    const location = new URL(signedIn.headers.get('location')!);
    expect(`${location.origin}${location.pathname}`).toBe(GEMINI_CALLBACK);
    const code = location.searchParams.get('code')!;
    const { body } = await exchange(handle, code, { redirect_uri: GEMINI_CALLBACK, code_verifier: '' });
    expect((await handle(listTools(body.access_token as string))).status).toBe(200);
  });

  it('refuses look-alike Google relay URLs', async () => {
    const { handle } = setup();
    for (const uri of [
      'https://oauth-redirect.googleusercontent.com/r/some-other-cloud-project', // relay to an arbitrary project
      'https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-1-x/../evil',
      'https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-1-x?next=https://evil.example',
      'https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-1-x#frag',
      'http://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-1-x',
      'https://oauth-redirect.googleusercontent.com:8443/r/user_bound_custom-mcp-1-x',
      'https://evil.googleusercontent.com/r/user_bound_custom-mcp-1-x',
      'https://oauth-redirect.googleusercontent.com.evil.example/r/user_bound_custom-mcp-1-x',
      'https://oauth-redirect-sandbox.googleusercontent.com/r/user_bound_custom-mcp-1-x',
    ]) {
      const response = await handle(new Request(`${ORIGIN}/oauth/authorize?${authorizeParams({ redirect_uri: uri })}`));
      expect({ uri, status: response.status, location: response.headers.get('location') }).toEqual({ uri, status: 400, location: null });
    }
  });

  it('redirects back with errors the client can handle', async () => {
    const { handle } = setup();
    const badType = await handle(new Request(`${ORIGIN}/oauth/authorize?${authorizeParams({ response_type: 'token' })}`));
    expect(badType.status).toBe(302);
    expect(new URL(badType.headers.get('location')!).searchParams.get('error')).toBe('unsupported_response_type');

    const plain = await handle(
      new Request(`${ORIGIN}/oauth/authorize?${authorizeParams({ code_challenge: 'abc', code_challenge_method: 'plain' })}`),
    );
    expect(new URL(plain.headers.get('location')!).searchParams.get('error')).toBe('invalid_request');
  });

  it('rejects a wrong MCP_AUTH_TOKEN without redirecting', async () => {
    const { handle } = setup();
    const response = await signIn(handle, authorizeParams(), 'wrong-token');
    expect(response.status).toBe(401);
    expect(response.headers.get('location')).toBeNull();
    expect(await response.text()).toMatch(/doesn&#39;t match MCP_AUTH_TOKEN/);
  });

  it('redirects with a code and the original state on the right token', async () => {
    const { handle } = setup();
    const { code, location } = await getCode(handle);
    expect(`${location.origin}${location.pathname}`).toBe(CLAUDE_CALLBACK);
    expect(location.searchParams.get('state')).toBe('xyz');
    expect(code).toMatch(/^gcm1\./);
  });
});

describe('/oauth/token', () => {
  it('exchanges a code for access and refresh tokens (client_secret_post and Basic)', async () => {
    for (const basic of [false, true]) {
      const { handle } = setup();
      const { code } = await getCode(handle);
      const { response, body } = await exchange(handle, code, {}, basic);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(body).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'garmin:read' });
      expect((await handle(listTools(body.access_token as string))).status).toBe(200);
    }
  });

  it('rejects a wrong client secret', async () => {
    const { handle } = setup();
    const { code } = await getCode(handle);
    const response = await handle(
      new Request(`${ORIGIN}/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: CLAUDE_CALLBACK, code_verifier: VERIFIER, client_id: CLIENT_ID, client_secret: 'nope' }),
      }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'invalid_client' });
  });

  const badExchanges: [string, Record<string, string>][] = [
    ['a wrong PKCE verifier', { code_verifier: 'another-verifier-of-sufficient-length-000000000000' }],
    ['a missing PKCE verifier', { code_verifier: '' }],
    ['a different redirect_uri', { redirect_uri: 'https://claude.com/api/mcp/auth_callback' }],
  ];
  for (const [label, extra] of badExchanges) {
    it(`rejects ${label}`, async () => {
      const { handle } = setup();
      const { code } = await getCode(handle);
      const { response, body } = await exchange(handle, code, extra);
      expect(response.status).toBe(400);
      expect(body.error).toBe('invalid_grant');
    });
  }

  it('rejects an expired code', async () => {
    const { handle, nowRef } = setup();
    const { code } = await getCode(handle);
    nowRef.now += 6 * 60 * 1000;
    expect((await exchange(handle, code)).body.error).toBe('invalid_grant');
  });

  it('works without PKCE for confidential clients (e.g. Gemini Enterprise)', async () => {
    const { handle } = setup();
    const response = await signIn(handle, authorizeParams({ code_challenge_method: undefined }));
    const code = new URL(response.headers.get('location')!).searchParams.get('code')!;
    const { body } = await exchange(handle, code, { code_verifier: '' });
    expect(body.access_token).toBeTruthy();
  });

  it('does not accept an access token as a code, or a code as an access token', async () => {
    const { handle } = setup();
    const { code } = await getCode(handle);
    expect((await handle(listTools(code))).status).toBe(401);
    const { body } = await exchange(handle, code);
    expect((await exchange(handle, body.access_token as string)).body.error).toBe('invalid_grant');
  });

  it('refreshes tokens', async () => {
    const { handle, nowRef } = setup();
    const { code } = await getCode(handle);
    const first = (await exchange(handle, code)).body;
    nowRef.now += 2 * 60 * 60 * 1000; // access token expired
    expect((await handle(listTools(first.access_token as string))).status).toBe(401);

    const refreshed = await handle(tokenRequest({ grant_type: 'refresh_token', refresh_token: first.refresh_token as string }));
    const body = (await refreshed.json()) as Record<string, string>;
    expect(refreshed.status).toBe(200);
    expect((await handle(listTools(body.access_token))).status).toBe(200);
  });

  it('rejects tampered tokens', async () => {
    const { handle } = setup();
    const { code } = await getCode(handle);
    const access = (await exchange(handle, code)).body.access_token as string;
    const [prefix, payload, signature] = access.split('.');
    const forged = JSON.parse(atob(payload!.replace(/-/g, '+').replace(/_/g, '/')));
    forged.exp += 10_000_000;
    const forgedPayload = btoa(JSON.stringify(forged)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect((await handle(listTools(`${prefix}.${forgedPayload}.${signature}`))).status).toBe(401);
  });

  it('revokes every OAuth token when MCP_AUTH_TOKEN changes', async () => {
    const shared = { now: Date.now() };
    const { handle } = setup({}, shared);
    const { code } = await getCode(handle);
    const access = (await exchange(handle, code)).body.access_token as string;

    const rotated = setup({ MCP_AUTH_TOKEN: 'a-brand-new-static-token-0123456789' }, shared).handle;
    expect((await rotated(listTools(access))).status).toBe(401);
  });

  it('rejects unsupported grant types', async () => {
    const { handle } = setup();
    const response = await handle(tokenRequest({ grant_type: 'client_credentials' }));
    expect(await response.json()).toMatchObject({ error: 'unsupported_grant_type' });
  });
});

describe('each auth method is optional', () => {
  it('refuses everything when neither MCP_AUTH_TOKEN nor MCP_OAUTH_CLIENT_SECRET is set', async () => {
    const { handle } = setup({ MCP_AUTH_TOKEN: undefined, MCP_OAUTH_CLIENT_SECRET: undefined });
    const response = await handle(listTools('anything'));
    expect(response.status).toBe(500);
    expect(await response.text()).toMatch(/set MCP_AUTH_TOKEN .*MCP_OAUTH_CLIENT_SECRET .*or both/);
  });

  it('bearer only: static token works, OAuth endpoints are off', async () => {
    const { handle } = setup({ MCP_OAUTH_CLIENT_SECRET: undefined });
    expect((await handle(listTools(AUTH_TOKEN))).status).toBe(200);
    expect((await handle(new Request(`${ORIGIN}/oauth/authorize?${authorizeParams()}`))).status).toBe(404);
  });

  describe('OAuth only (no MCP_AUTH_TOKEN)', () => {
    const oauthOnly = () => setup({ MCP_AUTH_TOKEN: undefined });

    it('asks for the client secret on the sign-in page', async () => {
      const { handle } = oauthOnly();
      const html = await (await handle(new Request(`${ORIGIN}/oauth/authorize?${authorizeParams()}`))).text();
      expect(html).toContain('<code>MCP_OAUTH_CLIENT_SECRET</code>');
      expect(html).not.toContain('MCP_AUTH_TOKEN');
    });

    it('signs in with the client secret and serves tools with the OAuth token', async () => {
      const { handle } = oauthOnly();
      const { code } = await getCode(handle, {}, CLIENT_SECRET);
      const { body } = await exchange(handle, code);
      expect((await handle(listTools(body.access_token as string))).status).toBe(200);
    });

    it('rejects a wrong secret on the sign-in page', async () => {
      const { handle } = oauthOnly();
      const response = await signIn(handle, authorizeParams(), AUTH_TOKEN);
      expect(response.status).toBe(401);
      expect(await response.text()).toMatch(/doesn&#39;t match MCP_OAUTH_CLIENT_SECRET/);
    });

    it('does not accept the client secret, or any static value, as a bearer token', async () => {
      const { handle } = oauthOnly();
      for (const bearer of [CLIENT_SECRET, AUTH_TOKEN, 'undefined', '']) {
        const response = await handle(listTools(bearer));
        expect(response.status).toBe(401);
        expect(await response.text()).not.toMatch(/MCP_AUTH_TOKEN/);
      }
    });

    it('revokes OAuth tokens when the client secret changes', async () => {
      const shared = { now: Date.now() };
      const { handle } = setup({ MCP_AUTH_TOKEN: undefined }, shared);
      const { code } = await getCode(handle, {}, CLIENT_SECRET);
      const access = (await exchange(handle, code)).body.access_token as string;
      const rotated = setup({ MCP_AUTH_TOKEN: undefined, MCP_OAUTH_CLIENT_SECRET: 'another-client-secret-0123456789xyz' }, shared).handle;
      expect((await rotated(listTools(access))).status).toBe(401);
    });
  });
});

describe('end to end with the MCP SDK OAuth client', () => {
  const modes = [
    { label: 'with MCP_AUTH_TOKEN set', env: {}, secret: AUTH_TOKEN },
    { label: 'OAuth only', env: { MCP_AUTH_TOKEN: undefined }, secret: CLIENT_SECRET },
  ];
  it.each(modes)('discovers, signs in, exchanges the code and lists tools ($label)', async ({ env, secret }) => {
    const { handle } = setup(env);
    const fetchViaHandler = (input: string | URL | Request, init?: RequestInit) =>
      handle(input instanceof Request ? input : new Request(input, init));

    let tokens: Awaited<ReturnType<OAuthClientProvider['tokens']>>;
    let verifier = '';
    let authorizationUrl: URL | undefined;
    const provider: OAuthClientProvider = {
      redirectUrl: 'http://localhost:6274/oauth/callback',
      clientMetadata: {
        client_name: 'sdk-test',
        redirect_uris: ['http://localhost:6274/oauth/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post',
      },
      clientInformation: () => ({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
      tokens: () => tokens,
      saveTokens: (value) => void (tokens = value),
      redirectToAuthorization: (url) => void (authorizationUrl = url),
      saveCodeVerifier: (value) => void (verifier = value),
      codeVerifier: () => verifier,
    };

    const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), { authProvider: provider, fetch: fetchViaHandler });
    const client = new Client({ name: 'sdk-test', version: '1.0.0' });
    await expect(client.connect(transport)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(authorizationUrl?.origin + authorizationUrl!.pathname).toBe(`${ORIGIN}/oauth/authorize`);
    expect(authorizationUrl!.searchParams.get('code_challenge_method')).toBe('S256');

    // The user opens the page and types MCP_AUTH_TOKEN.
    expect((await handle(new Request(authorizationUrl!))).status).toBe(200);
    const redirect = await signIn(handle, authorizationUrl!.searchParams, secret);
    const code = new URL(redirect.headers.get('location')!).searchParams.get('code')!;
    await transport.finishAuth(code);

    const connected = new Client({ name: 'sdk-test', version: '1.0.0' });
    await connected.connect(new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), { authProvider: provider, fetch: fetchViaHandler }));
    const { tools } = await connected.listTools();
    expect(tools).toHaveLength(26);
    const result = await connected.callTool({ name: 'garmin_get_user_settings', arguments: {} });
    expect((result.content as { text: string }[])[0]?.text).toBe('{"displayName":"runner"}');
    await connected.close();
  });
});
