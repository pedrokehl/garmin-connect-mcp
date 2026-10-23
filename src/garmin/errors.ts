import { API_KEY_SETTINGS_URL } from '../config.js';

const MAX_BODY_CHARS = 500;

/**
 * Per-request timeout for every call to Garmin, including reading the body. A tool
 * call makes at most four requests (token, data, and after a 401 token + data again),
 * so 4 × 12s stays under the 60s Vercel function limit set in vercel.json.
 */
export const GARMIN_TIMEOUT_MS = 12_000;

/** A non-2xx response from Garmin, with a message an LLM (or a human) can act on. */
export class GarminApiError extends Error {
  override name = 'GarminApiError';

  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly responseText: string,
  ) {
    super(describeStatus(status, method, path, responseText));
  }
}

function describeStatus(status: number, method: string, path: string, body: string): string {
  const isTokenExchange = method === 'POST';
  const detail = body ? ` Garmin said: ${truncate(body)}` : '';
  const where = `${method} ${path}`;

  if (isTokenExchange && (status === 400 || status === 401 || status === 403)) {
    return (
      `Garmin refused the Personal API key (${status} on ${where}). The key may be wrong, expired or deleted. ` +
      `Create a new one at ${API_KEY_SETTINGS_URL} and update GARMIN_API_KEY.${detail}`
    );
  }
  switch (status) {
    case 400:
      return `Garmin rejected the request as invalid (400 on ${where}). Check the parameters: dates must be YYYY-MM-DD, ranges must respect the documented maximum, and IDs must exist.${detail}`;
    case 401:
      return `Garmin rejected the access token (401 on ${where}) even after requesting a fresh one. The API key may have expired or been revoked; create a new one at ${API_KEY_SETTINGS_URL}.${detail}`;
    case 403:
      return `Not authorized (403 on ${where}). Personal API keys can only read the key owner's own data.${detail}`;
    case 404:
      return `Not found (404 on ${where}). The activity or record does not exist for this user.${detail}`;
    case 429:
      return `Rate limited by Garmin (429 on ${where}). Wait a minute and retry with fewer or smaller requests.${detail}`;
    default:
      if (status >= 500) return `Garmin server error (${status} on ${where}). Try again later.${detail}`;
      return `Unexpected response from Garmin (${status} on ${where}).${detail}`;
  }
}

function truncate(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > MAX_BODY_CHARS ? `${oneLine.slice(0, MAX_BODY_CHARS)}…` : oneLine;
}

/** Turn anything thrown while talking to Garmin into a message a model can act on. */
export function describeError(error: unknown): string {
  if (error instanceof GarminApiError) return error.message;
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return `Garmin did not respond within ${GARMIN_TIMEOUT_MS / 1000} seconds. Try again in a moment, or request a smaller date range.`;
    }
    if (error instanceof TypeError && /fetch failed|network/i.test(error.message)) {
      const cause = error.cause instanceof Error ? ` (${error.cause.message})` : '';
      return `Could not reach Garmin${cause}. Check the network connection and try again.`;
    }
    return error.message;
  }
  return String(error);
}
