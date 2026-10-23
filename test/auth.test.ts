import { describe, expect, it } from 'vitest';
import { TOKEN_PATH, TokenManager, extractToken, jwtExpiration, refreshTime } from '../src/garmin/auth.js';
import { GarminApiError } from '../src/garmin/errors.js';
import { BASE_URL, json, makeJwt, mockGarmin } from './helpers.js';

describe('TokenManager', () => {
  it('exchanges the key with POST and an "ApiKey" Authorization header', async () => {
    const garmin = mockGarmin(() => json({}));
    const tokens = new TokenManager({ apiKey: 'my-key', baseUrl: BASE_URL, fetch: garmin.fetch });

    const token = await tokens.getToken();

    expect(token).toMatch(/^ey/);
    const [call] = garmin.tokenCalls();
    expect(call?.url).toBe(BASE_URL + TOKEN_PATH);
    expect(call?.method).toBe('POST');
    expect(call?.headers.authorization).toBe('ApiKey my-key');
  });

  it('caches the token while it has more than an hour left', async () => {
    let now = Date.now();
    const exp = Math.floor(now / 1000) + 24 * 3600;
    const garmin = mockGarmin(
      () => json({}),
      () => new Response(makeJwt(exp)),
    );
    const tokens = new TokenManager({ apiKey: 'k', baseUrl: BASE_URL, fetch: garmin.fetch, now: () => now });

    await tokens.getToken();
    await tokens.getToken();
    expect(garmin.tokenCalls()).toHaveLength(1);

    now = exp * 1000 - 30 * 60 * 1000; // 30 minutes before expiry
    await tokens.getToken();
    expect(garmin.tokenCalls()).toHaveLength(2);
  });

  it('shares one in-flight exchange between concurrent callers', async () => {
    const garmin = mockGarmin(() => json({}));
    const tokens = new TokenManager({ apiKey: 'k', baseUrl: BASE_URL, fetch: garmin.fetch });

    const results = await Promise.all([tokens.getToken(), tokens.getToken(), tokens.getToken()]);

    expect(new Set(results).size).toBe(1);
    expect(garmin.tokenCalls()).toHaveLength(1);
  });

  it('forces a new exchange after invalidating the cached token', async () => {
    const garmin = mockGarmin(() => json({}));
    const tokens = new TokenManager({ apiKey: 'k', baseUrl: BASE_URL, fetch: garmin.fetch });

    const first = await tokens.getToken();
    tokens.invalidate(first);
    const second = await tokens.getToken();

    expect(garmin.tokenCalls()).toHaveLength(2);
    expect(second).not.toBe(first);
  });

  it('keeps a newer token when an older, rejected one is invalidated', async () => {
    const garmin = mockGarmin(() => json({}));
    const tokens = new TokenManager({ apiKey: 'k', baseUrl: BASE_URL, fetch: garmin.fetch });

    const stale = await tokens.getToken();
    tokens.invalidate(stale);
    const fresh = await tokens.getToken();
    tokens.invalidate(stale); // a slower request reporting the same old token

    expect(await tokens.getToken()).toBe(fresh);
    expect(garmin.tokenCalls()).toHaveLength(2);
  });

  it("reuses a short-lived token (key's last hour) instead of exchanging on every call", async () => {
    let now = Date.now();
    const exp = Math.floor(now / 1000) + 30 * 60;
    const garmin = mockGarmin(
      () => json({}),
      () => new Response(makeJwt(exp)),
    );
    const tokens = new TokenManager({ apiKey: 'k', baseUrl: BASE_URL, fetch: garmin.fetch, now: () => now });

    for (let i = 0; i < 5; i++) await tokens.getToken();
    expect(garmin.tokenCalls()).toHaveLength(1);

    now += 16 * 60 * 1000; // past the halfway point
    await tokens.getToken();
    expect(garmin.tokenCalls()).toHaveLength(2);
  });

  it('rejects a non-JWT 200 body (e.g. a maintenance page) and does not cache it', async () => {
    const garmin = mockGarmin(
      () => json({}),
      () => new Response('<html>maintenance</html>', { headers: { 'content-type': 'text/html' } }),
    );
    const tokens = new TokenManager({ apiKey: 'k', baseUrl: BASE_URL, fetch: garmin.fetch });

    await expect(tokens.getToken()).rejects.toThrow(/did not return a JWT \(text\/html/);
    await expect(tokens.getToken()).rejects.toThrow(GarminApiError);
    expect(garmin.tokenCalls()).toHaveLength(2);
  });

  it('reports 5xx from the token endpoint as a Garmin server error', async () => {
    const garmin = mockGarmin(
      () => json({}),
      () => new Response('oops', { status: 503 }),
    );
    const tokens = new TokenManager({ apiKey: 'k', baseUrl: BASE_URL, fetch: garmin.fetch });
    await expect(tokens.getToken()).rejects.toThrow(/Garmin server error \(503/);
  });

  it('turns a rejected key into an actionable error without leaking the key', async () => {
    const garmin = mockGarmin(
      () => json({}),
      () => new Response('invalid api key', { status: 401 }),
    );
    const tokens = new TokenManager({ apiKey: 'super-secret', baseUrl: BASE_URL, fetch: garmin.fetch });

    const error = await tokens.getToken().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GarminApiError);
    expect((error as Error).message).toContain('refused the Personal API key');
    expect((error as Error).message).toContain('personalApiToken');
    expect((error as Error).message).not.toContain('super-secret');
  });
});

describe('refreshTime', () => {
  const H = 60 * 60 * 1000;
  it('refreshes a 24h token one hour before expiry', () => {
    expect(refreshTime(0, 24 * H)).toBe(23 * H);
  });
  it('refreshes a short token halfway through its life', () => {
    expect(refreshTime(0, H / 2)).toBe(H / 4);
  });
  it('keeps reusing a token whose exp already passed by our clock for a few minutes', () => {
    expect(refreshTime(10 * H, 9 * H)).toBe(10 * H + 5 * 60 * 1000);
  });
});

describe('extractToken', () => {
  it('accepts a raw JWT body (what Garmin returns)', () => {
    expect(extractToken('  abc.def.ghi\n')).toBe('abc.def.ghi');
  });

  it('accepts JSON wrappers defensively', () => {
    expect(extractToken('{"access_token":"a.b.c"}')).toBe('a.b.c');
    expect(extractToken('{"accessToken":"a.b.c"}')).toBe('a.b.c');
  });
});

describe('jwtExpiration', () => {
  it('reads exp in milliseconds', () => {
    expect(jwtExpiration(makeJwt(1_800_000_000))).toBe(1_800_000_000_000);
  });

  it('returns undefined for non-JWTs', () => {
    expect(jwtExpiration('opaque-token')).toBeUndefined();
  });
});
