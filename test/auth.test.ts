import { describe, expect, it } from 'vitest';
import { TOKEN_PATH, TokenManager, extractToken, jwtExpiration } from '../src/garmin/auth.js';
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

  it('forces a new exchange after invalidate()', async () => {
    const garmin = mockGarmin(() => json({}));
    const tokens = new TokenManager({ apiKey: 'k', baseUrl: BASE_URL, fetch: garmin.fetch });

    await tokens.getToken();
    tokens.invalidate();
    await tokens.getToken();

    expect(garmin.tokenCalls()).toHaveLength(2);
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
