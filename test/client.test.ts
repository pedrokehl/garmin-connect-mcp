import { describe, expect, it } from 'vitest';
import { TokenManager } from '../src/garmin/auth.js';
import { GarminClient, buildQueryString } from '../src/garmin/client.js';
import { GarminApiError } from '../src/garmin/errors.js';
import { BASE_URL, json, mockGarmin } from './helpers.js';

function setup(onData: Parameters<typeof mockGarmin>[0]) {
  const garmin = mockGarmin(onData);
  const tokens = new TokenManager({ apiKey: 'k', baseUrl: BASE_URL, fetch: garmin.fetch });
  const client = new GarminClient({ baseUrl: BASE_URL, tokens, fetch: garmin.fetch });
  return { garmin, client };
}

describe('GarminClient.getJson', () => {
  it('sends a Bearer token and parses JSON', async () => {
    const { garmin, client } = setup(() => json({ displayName: 'me' }));

    const result = await client.getJson('/userprofile-service/userprofile/settings');

    expect(result).toEqual({ noData: false, data: { displayName: 'me' } });
    const [call] = garmin.dataCalls();
    expect(call?.headers.authorization).toMatch(/^Bearer ey/);
    expect(call?.url).toBe(`${BASE_URL}/userprofile-service/userprofile/settings`);
  });

  it('maps 204 No Content to noData', async () => {
    const { client } = setup(() => new Response(null, { status: 204 }));
    expect(await client.getJson('/hrv-service/hrv/2026-10-01')).toEqual({ noData: true });
  });

  it('refreshes the token and retries once on 401', async () => {
    let attempts = 0;
    const { garmin, client } = setup(() => (++attempts === 1 ? new Response('expired', { status: 401 }) : json([1])));

    const result = await client.getJson('/x');

    expect(result).toEqual({ noData: false, data: [1] });
    expect(garmin.tokenCalls()).toHaveLength(2);
    const [first, second] = garmin.dataCalls();
    expect(first?.headers.authorization).not.toBe(second?.headers.authorization);
  });

  it('gives up after the retry and explains the 401', async () => {
    const { garmin, client } = setup(() => new Response('nope', { status: 401 }));

    const error = await client.getJson('/x').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GarminApiError);
    expect((error as GarminApiError).status).toBe(401);
    expect(garmin.dataCalls()).toHaveLength(2);
  });

  it('explains other HTTP errors', async () => {
    const { client } = setup(() => new Response('bad date', { status: 400 }));
    await expect(client.getJson('/x')).rejects.toThrow(/invalid \(400 on GET \/x\).*bad date/);
  });
});

describe('GarminClient.getBinary', () => {
  it('returns bytes, content type and filename', async () => {
    const { client } = setup(
      () =>
        new Response(new Uint8Array([80, 75, 3, 4]), {
          headers: { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="123.zip"' },
        }),
    );

    const file = await client.getBinary('/download-service/files/activity/123');

    expect(Array.from(file.bytes)).toEqual([80, 75, 3, 4]);
    expect(file.contentType).toBe('application/zip');
    expect(file.filename).toBe('123.zip');
  });
});

describe('buildQueryString', () => {
  it('omits empty values, repeats arrays and stringifies booleans', () => {
    expect(
      buildQueryString({ a: 1, b: undefined, c: null, d: true, e: ['x', 'y'], f: 'hello world' }),
    ).toBe('?a=1&d=true&e=x&e=y&f=hello+world');
  });

  it('returns an empty string when nothing is set', () => {
    expect(buildQueryString({ a: undefined })).toBe('');
    expect(buildQueryString(undefined)).toBe('');
  });
});
