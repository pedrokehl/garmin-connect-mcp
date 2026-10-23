/**
 * Live smoke test: calls every tool against the real Garmin API using GARMIN_API_KEY from .env.
 *   npm run smoke
 * Prints only response shapes (types, counts, field names), never your values or tokens.
 */
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { loadGarminConfig } from '../src/config.js';
import { createGarminServer, createToolContext } from '../src/mcp-server.js';
import { allTools } from '../src/tools/index.js';
import { localToday } from '../src/tools/schemas.js';

const DAY_MS = 86_400_000;
const today = localToday();
const daysAgo = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * DAY_MS).toISOString().slice(0, 10);

type Args = Record<string, unknown>;
/** Tools that need an activity ID get it from the search results (never printed). */
const checks: [name: string, args: Args | ((activityId: number) => Args)][] = [
  ['garmin_get_user_settings', {}],
  ['garmin_search_activities', { limit: 3 }],
  ['garmin_get_activity', (id) => ({ activityId: id })],
  ['garmin_get_activity_workouts', (id) => ({ activityId: id })],
  ['garmin_download_activity_file', (id) => ({ activityId: id })],
  ['garmin_get_daily_summary', { calendarDate: today }],
  ['garmin_get_daily_summaries', { startDate: daysAgo(29), endDate: today }],
  ['garmin_get_steps', { startDate: daysAgo(6), endDate: today }],
  ['garmin_get_stress', { startDate: daysAgo(6), endDate: today }],
  ['garmin_get_hydration', { startDate: daysAgo(6), endDate: today }],
  ['garmin_get_wellness_activities', { fromDate: daysAgo(29), untilDate: today }],
  ['garmin_get_sleep', { date: today }],
  ['garmin_get_sleep_summaries', { startDate: daysAgo(6), endDate: today }],
  ['garmin_get_heart_rate', { date: daysAgo(1) }],
  ['garmin_get_heart_rate_zones', {}],
  ['garmin_get_hrv', { calendarDate: today }],
  ['garmin_get_hrv_summaries', { fromDate: daysAgo(6), toDate: today }],
  ['garmin_get_body_battery', { startDate: daysAgo(1), endDate: today, chunks: 4 }],
  ['garmin_get_spo2', { calendarDate: daysAgo(1) }],
  ['garmin_get_fitness_age', { calendarDate: today }],
  ['garmin_get_weight_entries', { startDate: daysAgo(89), endDate: today }],
  ['garmin_get_weight_summary', { startDate: daysAgo(89), endDate: today }],
  ['garmin_get_weight_goals', { startDate: daysAgo(364), endDate: today }],
  ['garmin_get_nutrition_log', { date: daysAgo(1), includeMedia: false }],
  ['garmin_get_menstrual_cycle_summary', { calendarDate: today }],
  ['garmin_get_menstrual_cycle_day', { calendarDate: today, todayDate: today }],
];

const missing = allTools.map((t) => t.name).filter((name) => !checks.some(([n]) => n === name));
if (missing.length) throw new Error(`Smoke test is missing tools: ${missing.join(', ')}`);

/** Describe a value by structure only: types, lengths and field names, no values. */
function shape(value: unknown, depth = 0): string {
  if (Array.isArray(value)) return `array(${value.length})${value.length && depth < 1 ? ` of ${shape(value[0], depth + 1)}` : ''}`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    return `object{${keys.slice(0, 5).join(', ')}${keys.length > 5 ? `, …+${keys.length - 5}` : ''}}`;
  }
  return value === null ? 'null' : typeof value;
}

const server = createGarminServer(createToolContext(loadGarminConfig(), { today: localToday }));
const client = new Client({ name: 'smoke', version: '1.0.0' });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
await client.connect(clientTransport);

let activityId: number | undefined;
const tally = { ok: 0, noData: 0, skipped: 0, failed: 0 };

for (const [name, argsOrFn] of checks) {
  let args: Args;
  if (typeof argsOrFn === 'function') {
    if (activityId === undefined) {
      tally.skipped += 1;
      console.log(`- ${name}: skipped (no activities found)`);
      continue;
    }
    args = argsOrFn(activityId);
  } else {
    args = argsOrFn;
  }

  const started = Date.now();
  const result = await client.callTool({ name, arguments: args });
  const ms = `${Date.now() - started}ms`;
  const blocks = (result.content ?? []) as { type: string; text?: string; resource?: { mimeType?: string; blob?: string } }[];
  const text = blocks[0]?.text ?? '';

  if (result.isError) {
    tally.failed += 1;
    console.log(`✗ ${name} (${ms}): ${text}`);
    continue;
  }

  if (name === 'garmin_download_activity_file') {
    const resource = blocks.find((b) => b.type === 'resource')?.resource;
    const kb = resource?.blob ? ((resource.blob.length * 3) / 4 / 1024).toFixed(1) : '?';
    tally.ok += 1;
    console.log(`✓ ${name} (${ms}): resource(${resource?.mimeType ?? 'unknown'}, ~${kb} KB)`);
    continue;
  }

  const data: unknown = JSON.parse(text);
  if (data && typeof data === 'object' && (data as { noData?: unknown }).noData === true) {
    tally.noData += 1;
    console.log(`○ ${name} (${ms}): no data recorded`);
    continue;
  }
  if (name === 'garmin_search_activities' && Array.isArray(data)) {
    const first = data[0] as { activityId?: unknown } | undefined;
    if (typeof first?.activityId === 'number') activityId = first.activityId;
  }
  tally.ok += 1;
  console.log(`✓ ${name} (${ms}): ${shape(data)}`);
}

console.log(`\n${tally.ok} ok, ${tally.noData} no data, ${tally.skipped} skipped, ${tally.failed} failed (of ${checks.length} tools)`);
await client.close();
await server.close();
process.exit(tally.failed ? 1 : 0);
