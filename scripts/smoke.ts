/**
 * Live smoke test against the real Garmin API using GARMIN_API_KEY from .env.
 *   npm run smoke
 * Prints only shapes and counts, never your data or tokens.
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { loadGarminConfig } from '../src/config.js';
import { createGarminServer, createToolContext } from '../src/server.js';

const today = new Date().toISOString().slice(0, 10);
const weekAgo = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);

const checks: [string, Record<string, unknown>][] = [
  ['garmin_get_user_settings', {}],
  ['garmin_search_activities', { limit: 3 }],
  ['garmin_get_daily_summary', { calendarDate: today }],
  ['garmin_get_sleep_summaries', { startDate: weekAgo, endDate: today }],
  ['garmin_get_steps', { startDate: weekAgo, endDate: today }],
];

const server = createGarminServer(createToolContext(loadGarminConfig()));
const client = new Client({ name: 'smoke', version: '1.0.0' });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
await client.connect(clientTransport);

let failures = 0;
for (const [name, args] of checks) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { text?: string }[])[0]?.text ?? '';
  if (result.isError) {
    failures += 1;
    console.log(`✗ ${name}: ${text}`);
    continue;
  }
  const data: unknown = JSON.parse(text);
  const shape = Array.isArray(data) ? `array(${data.length})` : `object{${Object.keys(data as object).slice(0, 6).join(', ')}…}`;
  console.log(`✓ ${name}: ${shape}`);
}

await client.close();
await server.close();
process.exit(failures ? 1 : 0);
