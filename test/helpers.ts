import { vi } from 'vitest';

export const BASE_URL = 'https://garmin.test';

/** Unsigned JWT with the given `exp` (epoch seconds). */
export function makeJwt(expSeconds: number): string {
  const b64 = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64({ exp: expSeconds, sub: 'user' })}.sig`;
}

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}

type Responder = (call: RecordedCall) => Response | Promise<Response>;

/**
 * A fetch mock that answers the token exchange with a fresh JWT (unless overridden)
 * and routes every other call to `onData`.
 */
export function mockGarmin(onData: Responder, onToken?: Responder) {
  const calls: RecordedCall[] = [];
  let tokenCount = 0;
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const call: RecordedCall = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    };
    calls.push(call);
    if (call.url.includes('/personalapitoken-service/')) {
      tokenCount += 1;
      if (onToken) return onToken(call);
      return new Response(makeJwt(Math.floor(Date.now() / 1000) + 24 * 3600).replace('sig', `sig${tokenCount}`), {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
    }
    return onData(call);
  });
  return {
    fetch: fetchMock as unknown as typeof fetch,
    calls,
    dataCalls: () => calls.filter((c) => !c.url.includes('/personalapitoken-service/')),
    tokenCalls: () => calls.filter((c) => c.url.includes('/personalapitoken-service/')),
  };
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}
