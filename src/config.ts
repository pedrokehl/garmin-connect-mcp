export const DEFAULT_BASE_URL = 'https://personal.connectapi.garmin.com';
export const API_KEY_SETTINGS_URL = 'https://connect.garmin.com/app/settings/personalApiToken';

export interface GarminConfig {
  /** Garmin Connect Personal API key (exchanged for a 24h bearer token). */
  apiKey: string;
  /** API host, without trailing slash. */
  baseUrl: string;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

type Env = Record<string, string | undefined>;

export function loadGarminConfig(env: Env = processEnv()): GarminConfig {
  const apiKey = env.GARMIN_API_KEY?.trim();
  if (!apiKey) {
    throw new ConfigError(
      `GARMIN_API_KEY is not set. Create a Personal API key at ${API_KEY_SETTINGS_URL} and set it as an environment variable.`,
    );
  }
  const baseUrl = (env.GARMIN_API_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
  return { apiKey, baseUrl };
}

/** Environment variables from the global `process` object where one exists (Node, Vercel, Workers with nodejs_compat), otherwise empty. */
export function processEnv(): Env {
  return (globalThis as { process?: { env?: Env } }).process?.env ?? {};
}
