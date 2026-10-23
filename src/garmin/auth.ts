import { GARMIN_TIMEOUT_MS, GarminApiError } from './errors.js';

export const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';

/** Refresh a 24h token once it has less than this left (matches Garmin's reference client). */
const REFRESH_WINDOW_MS = 60 * 60 * 1000;
/** Used only if Garmin ever returns a JWT without a readable `exp` claim. */
const FALLBACK_LIFETIME_MS = 23 * 60 * 60 * 1000;
/** If `exp` is already past by our clock (clock skew), keep using the token this long; a 401 still forces a new one. */
const SKEWED_TOKEN_REUSE_MS = 5 * 60 * 1000;
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

export interface AccessToken {
  value: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  /** Epoch milliseconds after which a new token is requested. */
  refreshAt: number;
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

  async getToken(): Promise<string> {
    if (this.cached && this.now() < this.cached.refreshAt) return this.cached.value;
    this.inFlight ??= this.exchange().finally(() => {
      this.inFlight = undefined;
    });
    const token = await this.inFlight;
    return token.value;
  }

  /**
   * Drop the cached token after Garmin rejected it with 401. Only clears the cache
   * if it still holds the rejected token, so a token another request already
   * refreshed is kept.
   */
  invalidate(rejectedToken: string): void {
    if (this.cached?.value === rejectedToken) this.cached = undefined;
  }

  private async exchange(): Promise<AccessToken> {
    const response = await this.fetchFn(this.baseUrl + TOKEN_PATH, {
      method: 'POST',
      headers: { Accept: '*/*', Authorization: `ApiKey ${this.apiKey}` },
      signal: AbortSignal.timeout(GARMIN_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new GarminApiError(response.status, 'POST', TOKEN_PATH, text);
    }
    const value = extractToken(text);
    if (!JWT_SHAPE.test(value)) {
      // E.g. an HTML maintenance page served with 200. Never cache it, and don't echo it back.
      const contentType = response.headers.get('content-type') ?? 'unknown content type';
      throw new GarminApiError(
        response.status,
        'POST',
        TOKEN_PATH,
        `The token endpoint did not return a JWT (${contentType}, ${text.length} bytes). Garmin may be down; try again later.`,
      );
    }
    const now = this.now();
    const expiresAt = jwtExpiration(value) ?? now + FALLBACK_LIFETIME_MS;
    const token = { value, expiresAt, refreshAt: refreshTime(now, expiresAt) };
    this.cached = token;
    return token;
  }
}

/**
 * When to replace a token issued at `now`: an hour before expiry for normal 24h
 * tokens, but never less than halfway through its life. Tokens are capped at
 * the key's expiry, so in the key's last hour a fixed one-hour window would
 * request a new token on every call.
 */
export function refreshTime(now: number, expiresAt: number): number {
  const lifetime = expiresAt - now;
  if (lifetime <= 0) return now + SKEWED_TOKEN_REUSE_MS;
  return now + Math.max(lifetime - REFRESH_WINDOW_MS, lifetime / 2);
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
