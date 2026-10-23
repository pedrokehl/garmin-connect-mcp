import type { TokenManager } from './auth.js';
import { GARMIN_TIMEOUT_MS, GarminApiError } from './errors.js';


export type QueryValue = string | number | boolean | readonly (string | number)[] | null | undefined;
export type Query = Record<string, QueryValue>;

export type JsonResult = { noData: true } | { noData: false; data: unknown };

export interface BinaryResult {
  bytes: Uint8Array;
  contentType: string;
  filename?: string;
}

export interface GarminClientOptions {
  baseUrl: string;
  tokens: TokenManager;
  fetch?: typeof fetch;
}

/** Thin read-only HTTP client for the Garmin Connect Personal API. */
export class GarminClient {
  private readonly baseUrl: string;
  private readonly tokens: TokenManager;
  private readonly fetchFn: typeof fetch;

  constructor(options: GarminClientOptions) {
    this.baseUrl = options.baseUrl;
    this.tokens = options.tokens;
    this.fetchFn = options.fetch ?? globalThis.fetch;
  }

  /** GET a JSON endpoint. 204 No Content becomes `{ noData: true }`. */
  async getJson(path: string, query?: Query): Promise<JsonResult> {
    const response = await this.send(path, query, 'application/json');
    if (response.status === 204) return { noData: true };
    const text = await response.text();
    if (!text.trim()) return { noData: true };
    try {
      return { noData: false, data: JSON.parse(text) };
    } catch {
      return { noData: false, data: text };
    }
  }

  /** GET a binary endpoint (activity file download). */
  async getBinary(path: string, query?: Query): Promise<BinaryResult> {
    const response = await this.send(path, query, '*/*');
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      bytes,
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      filename: filenameFromDisposition(response.headers.get('content-disposition')),
    };
  }

  private async send(path: string, query: Query | undefined, accept: string): Promise<Response> {
    const url = this.baseUrl + path + buildQueryString(query);
    let { response, token } = await this.attempt(url, accept);
    if (response.status === 401) {
      // Token may have been revoked or expired early: get a new one and retry once.
      await response.body?.cancel();
      this.tokens.invalidate(token);
      ({ response } = await this.attempt(url, accept));
    }
    if (!response.ok) {
      throw new GarminApiError(response.status, 'GET', path, await response.text());
    }
    return response;
  }

  private async attempt(url: string, accept: string): Promise<{ response: Response; token: string }> {
    const token = await this.tokens.getToken();
    const response = await this.fetchFn(url, {
      method: 'GET',
      headers: { Accept: accept, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(GARMIN_TIMEOUT_MS),
    });
    return { response, token };
  }
}

/** Omits null/undefined, repeats array values (`?a=1&a=2`), stringifies booleans. */
export function buildQueryString(query: Query | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
    } else {
      params.append(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** Encode a single path segment (IDs, dates). */
export function seg(value: string | number): string {
  return encodeURIComponent(String(value));
}

function filenameFromDisposition(header: string | null): string | undefined {
  if (!header) return undefined;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}
