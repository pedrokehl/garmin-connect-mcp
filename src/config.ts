import { homedir } from 'node:os';
import { resolve } from 'node:path';

export const DEFAULT_BASE_URL = 'https://personal.connectapi.garmin.com';
export const API_KEY_SETTINGS_URL = 'https://connect.garmin.com/app/settings/personalApiToken';

export interface GarminConfig {
  /** Garmin Connect Personal API key (exchanged for a 24h bearer token). */
  apiKey: string;
  /** API host, without trailing slash. */
  baseUrl: string;
  /** Stdio only: where downloaded activity files are written. */
  downloadDir?: string;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

type Env = Record<string, string | undefined>;

export function loadGarminConfig(env: Env = process.env): GarminConfig {
  const apiKey = env.GARMIN_API_KEY?.trim();
  if (!apiKey) {
    throw new ConfigError(
      `GARMIN_API_KEY is not set. Create a Personal API key at ${API_KEY_SETTINGS_URL} and set it as an environment variable.`,
    );
  }
  const baseUrl = (env.GARMIN_API_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const downloadDir = env.GARMIN_DOWNLOAD_DIR?.trim();
  return {
    apiKey,
    baseUrl,
    downloadDir: downloadDir ? expandHome(downloadDir) : undefined,
  };
}

function expandHome(path: string): string {
  return resolve(path === '~' || path.startsWith('~/') ? homedir() + path.slice(1) : path);
}
