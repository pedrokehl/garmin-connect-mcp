/**
 * Node-only helpers for the stdio server. Never import this from the HTTP path
 * (src/http.ts and everything it reaches must stay web-standard).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function expandHome(path: string): string {
  return resolve(path === '~' || path.startsWith('~/') ? homedir() + path.slice(1) : path);
}

/** Returns a saver that writes downloads into `dir` (created on first use) and returns the full path. */
export function createFileSaver(dir: string): (filename: string, bytes: Uint8Array) => Promise<string> {
  const root = expandHome(dir);
  return async (filename, bytes) => {
    await mkdir(root, { recursive: true });
    const target = join(root, filename);
    await writeFile(target, bytes);
    return target;
  };
}
