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

/** Thrown by getBinary when a download exceeds `maxBytes`; the body is not read past the limit. */
export class FileTooLargeError extends Error {
  override name = 'FileTooLargeError';

  constructor(
    readonly maxBytes: number,
    /** From Content-Length when Garmin sent it. */
    readonly declaredBytes?: number,
  ) {
    super(`File is larger than ${maxBytes} bytes.`);
  }
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

  /** GET a binary endpoint (activity file download), optionally refusing files over `maxBytes`. */
  async getBinary(path: string, options: { query?: Query; maxBytes?: number } = {}): Promise<BinaryResult> {
    const response = await this.send(path, options.query, '*/*');
    const bytes = await readBody(response, options.maxBytes);
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

/** Read a body into memory, stopping (and cancelling the download) as soon as it exceeds `maxBytes`. */
async function readBody(response: Response, maxBytes?: number): Promise<Uint8Array> {
  if (maxBytes === undefined || !response.body) return new Uint8Array(await response.arrayBuffer());

  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body.cancel();
    throw new FileTooLargeError(maxBytes, declared);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new FileTooLargeError(maxBytes);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Filename from Content-Disposition. Only the RFC 5987 `filename*=UTF-8''...` form is
 * percent-decoded; a plain `filename="run 100%.zip"` is taken literally.
 */
export function filenameFromDisposition(header: string | null): string | undefined {
  if (!header) return undefined;
  const extended = /filename\*\s*=\s*(?:UTF-8|ISO-8859-1)?'[^']*'([^;]+)/i.exec(header);
  if (extended?.[1]) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      // Malformed percent-encoding: fall back to the plain parameter.
    }
  }
  const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(header);
  const value = (plain?.[1] ?? plain?.[2])?.trim();
  return value || undefined;
}
