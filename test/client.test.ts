import { describe, expect, it } from 'vitest';
import { TokenManager } from '../src/garmin/auth.js';
import { FileTooLargeError, GarminClient, buildQueryString, filenameFromDisposition } from '../src/garmin/client.js';
import { GarminApiError } from '../src/garmin/errors.js';
import { BASE_URL, json, makeJwt, mockGarmin } from './helpers.js';

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

  it('puts a timeout on every request to Garmin', async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    const tokens = new TokenManager({
      apiKey: 'k',
      baseUrl: BASE_URL,
      fetch: (async (_url: string, init?: RequestInit) => {
        signals.push(init?.signal);
        return new Response(makeJwt(Math.floor(Date.now() / 1000) + 86_400));
      }) as typeof fetch,
    });
    const client = new GarminClient({
      baseUrl: BASE_URL,
      tokens,
      fetch: (async (_url: string, init?: RequestInit) => {
        signals.push(init?.signal);
        return json({});
      }) as typeof fetch,
    });

    await client.getJson('/x');

    expect(signals).toHaveLength(2);
    for (const signal of signals) expect(signal).toBeInstanceOf(AbortSignal);
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

  it('a late 401 on an old token does not throw away the token another request already refreshed', async () => {
    let revoked: string | undefined;
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((resolve) => (releaseSlow = resolve));
    const { garmin, client } = setup(async (call) => {
      revoked ??= call.headers.authorization;
      if (call.headers.authorization !== revoked) return json({ ok: true });
      if (call.url.endsWith('/slow')) await slowGate;
      return new Response('revoked', { status: 401 });
    });

    const slow = client.getJson('/slow'); // holds the old token, answered late
    await client.getJson('/fast'); // 401 → refresh → retry succeeds
    releaseSlow();
    await slow; // 401 on the old token → must reuse the refreshed one

    expect(garmin.tokenCalls()).toHaveLength(2);
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

describe('filenameFromDisposition', () => {
  it('takes plain filenames literally, even with %', () => {
    expect(filenameFromDisposition('attachment; filename="run 100%.zip"')).toBe('run 100%.zip');
    expect(filenameFromDisposition('attachment; filename=123.zip')).toBe('123.zip');
  });

  it('decodes RFC 5987 filenames and falls back when they are malformed', () => {
    expect(filenameFromDisposition("attachment; filename*=UTF-8''caf%C3%A9.zip")).toBe('café.zip');
    expect(filenameFromDisposition("attachment; filename=\"plain.zip\"; filename*=UTF-8''bad%E0%A4%A.zip")).toBe('plain.zip');
  });

  it('returns undefined when there is no filename', () => {
    expect(filenameFromDisposition(null)).toBeUndefined();
    expect(filenameFromDisposition('inline')).toBeUndefined();
  });
});

describe('GarminClient.getBinary size limit', () => {
  it('refuses early based on Content-Length and cancels the body', async () => {
    let cancelled = false;
    const body = new ReadableStream({ cancel: () => void (cancelled = true) });
    const { client } = setup(() => new Response(body, { headers: { 'content-length': '5000' } }));

    const error = await client.getBinary('/f', { maxBytes: 1000 }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(FileTooLargeError);
    expect((error as FileTooLargeError).declaredBytes).toBe(5000);
    expect(cancelled).toBe(true);
  });

  it('stops reading a stream without Content-Length once it passes the limit', async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        pulls += 1;
        controller.enqueue(new Uint8Array(400));
      },
    });
    const { client } = setup(() => new Response(body));

    await expect(client.getBinary('/f', { maxBytes: 1000 })).rejects.toBeInstanceOf(FileTooLargeError);
    expect(pulls).toBeLessThan(10);
  });

  it('returns files under the limit', async () => {
    const { client } = setup(() => new Response(new Uint8Array(999)));
    expect((await client.getBinary('/f', { maxBytes: 1000 })).bytes.byteLength).toBe(999);
  });
});
