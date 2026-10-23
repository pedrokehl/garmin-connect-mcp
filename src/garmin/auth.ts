import { GarminApiError } from './errors.js';

export const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';

/** Reuse a cached token only while it has more than this much life left (matches Garmin's reference client). */
const REFRESH_WINDOW_MS = 60 * 60 * 1000;
/** Used only if Garmin ever returns a token without a readable `exp` claim. */
const FALLBACK_LIFETIME_MS = 23 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;

export interface AccessToken {
  value: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export interface TokenManagerOptions {
  apiKey: string;
  baseUrl: string;
  fetch?: typeof fetch;
  now?: () => number;
}

/**
 * Exchanges the Personal API key for a bearer token and caches it in memory.
 *
 * Garmin issues JWT access tokens valid for 24h (or until the key expires) and
 * has no refresh tokens: getting a new token means calling the exchange again.
 * Concurrent callers share one in-flight exchange.
 */
export class TokenManager {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private cached?: AccessToken;
  private inFlight?: Promise<AccessToken>;

  constructor(options: TokenManagerOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl;
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
  }

  async getToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.cached && this.cached.expiresAt - this.now() > REFRESH_WINDOW_MS) {
      return this.cached.value;
    }
    this.inFlight ??= this.exchange().finally(() => {
      this.inFlight = undefined;
    });
    const token = await this.inFlight;
    return token.value;
  }

  /** Drop the cached token, e.g. after Garmin answered 401. */
  invalidate(): void {
    this.cached = undefined;
  }

  private async exchange(): Promise<AccessToken> {
    const response = await this.fetchFn(this.baseUrl + TOKEN_PATH, {
      method: 'POST',
      headers: { Accept: '*/*', Authorization: `ApiKey ${this.apiKey}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new GarminApiError(response.status, 'POST', TOKEN_PATH, text);
    }
    const value = extractToken(text);
    if (!value) {
      throw new GarminApiError(response.status, 'POST', TOKEN_PATH, 'Token endpoint returned an empty body.');
    }
    const exp = jwtExpiration(value);
    const token = { value, expiresAt: exp ?? this.now() + FALLBACK_LIFETIME_MS };
    this.cached = token;
    return token;
  }
}

/** Garmin returns the raw JWT as the response body; tolerate a JSON wrapper too. */
export function extractToken(body: string): string {
  const trimmed = body.trim();
  if (!trimmed.startsWith('{')) return trimmed.replace(/^"|"$/g, '');
  try {
    const json = JSON.parse(trimmed) as Record<string, unknown>;
    const candidate = json.access_token ?? json.accessToken ?? json.token;
    return typeof candidate === 'string' ? candidate.trim() : '';
  } catch {
    return '';
  }
}

/** Read the `exp` claim (epoch seconds) of a JWT without verifying it; returns epoch ms. */
export function jwtExpiration(token: string): number | undefined {
  const payload = token.split('.')[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown };
    return typeof claims.exp === 'number' ? claims.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}
