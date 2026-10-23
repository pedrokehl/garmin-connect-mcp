import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadGarminConfig } from '../src/config.js';
import { base64UrlToString, toBase64 } from '../src/encoding.js';
import { localToday, utcToday } from '../src/tools/schemas.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

/** Every project source file reachable from `entry` through relative imports. */
async function importGraph(entry: string, seen = new Set<string>()): Promise<Set<string>> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const code = await readFile(entry, 'utf8');
  for (const [, spec] of code.matchAll(/(?:import|export)\s[^'"]*?from\s+'(\.[^']+)'/g)) {
    await importGraph(join(dirname(entry), spec!.replace(/\.js$/, '.ts')), seen);
  }
  return seen;
}

describe('HTTP path portability (Vercel, Workers, Netlify, Deno)', () => {
  it('reaches no Node-only modules or globals from src/http.ts', async () => {
    const files = await importGraph(join(SRC, 'http.ts'));
    expect([...files].map((f) => f.slice(SRC.length + 1))).toContain('tools/activities.ts');

    for (const file of files) {
      const code = await readFile(file, 'utf8');
      const offending = code
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line)) // comments may mention these names
        .filter((line) => /from\s+'node:|\bBuffer\b|\brequire\(/.test(line) || /\bprocess\.env\b/.test(line));
      expect({ file: file.slice(SRC.length + 1), offending }).toEqual({ file: file.slice(SRC.length + 1), offending: [] });
    }
  });
});

describe('encoding helpers', () => {
  it('toBase64 matches Node for small and large inputs', () => {
    for (const size of [0, 1, 2, 3, 100_000]) {
      const bytes = Uint8Array.from({ length: size }, (_, i) => (i * 31) % 256);
      expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    }
  });

  it('base64UrlToString decodes unpadded base64url UTF-8', () => {
    const text = '{"exp":1800000000,"name":"café ✓"}';
    expect(base64UrlToString(Buffer.from(text).toString('base64url'))).toBe(text);
  });
});

describe('loadGarminConfig', () => {
  it('requires GARMIN_API_KEY', () => {
    expect(() => loadGarminConfig({})).toThrow(/GARMIN_API_KEY is not set/);
    expect(() => loadGarminConfig({ GARMIN_API_KEY: '   ' })).toThrow(/GARMIN_API_KEY is not set/);
  });

  it('trims values and strips trailing slashes from the base URL', () => {
    expect(loadGarminConfig({ GARMIN_API_KEY: ' k ', GARMIN_API_BASE_URL: 'https://x.test//' })).toEqual({
      apiKey: 'k',
      baseUrl: 'https://x.test',
    });
  });

  it('defaults the base URL to Garmin', () => {
    expect(loadGarminConfig({ GARMIN_API_KEY: 'k' }).baseUrl).toBe('https://personal.connectapi.garmin.com');
  });
});

describe('dates', () => {
  it('localToday and utcToday are YYYY-MM-DD and at most a day apart', () => {
    const local = localToday();
    const utc = utcToday();
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(utc).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Math.abs(Date.parse(local) - Date.parse(utc))).toBeLessThanOrEqual(86_400_000);
  });
});

describe('Vercel config', () => {
  it('points outputDirectory at a folder that exists (Vercel fails the build otherwise)', async () => {
    const root = resolve(SRC, '..');
    const config = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8')) as {
      outputDirectory?: string;
      functions?: Record<string, { maxDuration?: number }>;
    };
    expect(config.outputDirectory).toBeTruthy();
    await expect(readFile(join(root, config.outputDirectory!, 'index.html'), 'utf8')).resolves.toContain('<html');
    expect(config.functions?.['api/mcp.ts']?.maxDuration).toBeGreaterThanOrEqual(60);
  });
});
