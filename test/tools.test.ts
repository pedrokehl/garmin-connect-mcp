import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createGarminServer, createToolContext } from '../src/server.js';
import { allTools } from '../src/tools/index.js';
import { BASE_URL, json, mockGarmin, type RecordedCall } from './helpers.js';

/** Every operation in Garmin's Personal API OpenAPI spec (v1.0.0). */
const SPEC_ENDPOINTS = [
  'GET /activity-service/activity/{activityId}',
  'GET /activity-service/activity/{activityId}/workouts',
  'GET /activitylist-service/activities/search/activities',
  'GET /biometric-service/heartRateZones/v2',
  'GET /download-service/files/activity/{activityId}',
  'GET /fitnessage-service/fitnessage/v2/{calendarDate}',
  'GET /goal-service/goal/user/effective/weightgoal/{startDate}/{endDate}',
  'GET /hrv-service/hrv/{calendarDate}',
  'GET /hrv-service/hrv/daily/{fromDate}/{toDate}',
  'GET /nutrition-service/food/logs/{date}',
  'GET /periodichealth-service/menstrualcycle/summary/{calendarDate}',
  'GET /periodichealth-service/menstrualcycle/dayview/{calendarDate}',
  'GET /sleep-service/sleep/dailySleep',
  'GET /sleep-service/sleep/dailySleepSummariesByDate',
  'GET /userprofile-service/userprofile/settings',
  'GET /usersummary-service/stats/hydration/daily/{startDate}/{endDate}',
  'GET /usersummary-service/stats/steps/daily/{startDate}/{endDate}',
  'GET /usersummary-service/stats/stress/daily/{startDate}/{endDate}',
  'GET /usersummary-service/usersummary/daily',
  'GET /usersummary-service/v2/dailysummaries',
  'GET /weight-service/weight/all/{startDate}/{endDate}',
  'GET /weight-service/weight/range/{startDate}/{endDate}',
  'GET /wellness-service/wellness/bodyBattery/reports/daily',
  'GET /wellness-service/wellness/daily/spo2acclimation/{calendarDate}',
  'GET /wellness-service/wellness/dailyHeartRate',
  'GET /wellnessactivity-service/activity/summary/range/{fromDate}/{untilDate}',
];

/** Sample arguments per tool and the URL (path + query) Garmin must receive. */
const CASES: Record<string, { args: Record<string, unknown>; url: string }> = {
  garmin_get_user_settings: { args: {}, url: '/userprofile-service/userprofile/settings' },
  garmin_search_activities: {
    args: { activityType: 'running', startDate: '2026-10-01', excludedActivitySubType: ['treadmill_running', 'track_running'] },
    url: '/activitylist-service/activities/search/activities?limit=20&startDate=2026-10-01&activityType=running&excludedActivitySubType=treadmill_running&excludedActivitySubType=track_running',
  },
  garmin_get_activity: { args: { activityId: 12345 }, url: '/activity-service/activity/12345' },
  garmin_get_activity_workouts: { args: { activityId: '12345' }, url: '/activity-service/activity/12345/workouts' },
  garmin_download_activity_file: { args: { activityId: 12345 }, url: '/download-service/files/activity/12345' },
  garmin_get_daily_summary: { args: { calendarDate: '2026-10-20' }, url: '/usersummary-service/usersummary/daily?calendarDate=2026-10-20' },
  garmin_get_daily_summaries: {
    args: { startDate: '2026-01-01', endDate: '2026-10-20' },
    url: '/usersummary-service/v2/dailysummaries?startDate=2026-01-01&endDate=2026-10-20',
  },
  garmin_get_steps: { args: { startDate: '2026-10-01', endDate: '2026-10-28' }, url: '/usersummary-service/stats/steps/daily/2026-10-01/2026-10-28' },
  garmin_get_stress: { args: { startDate: '2026-10-01', endDate: '2026-10-07' }, url: '/usersummary-service/stats/stress/daily/2026-10-01/2026-10-07' },
  garmin_get_hydration: { args: { startDate: '2026-10-01', endDate: '2026-10-31' }, url: '/usersummary-service/stats/hydration/daily/2026-10-01/2026-10-31' },
  garmin_get_wellness_activities: {
    args: { fromDate: '2026-10-01', untilDate: '2026-10-07' },
    url: '/wellnessactivity-service/activity/summary/range/2026-10-01/2026-10-07',
  },
  garmin_get_sleep: { args: { date: '2026-10-20' }, url: '/sleep-service/sleep/dailySleep?date=2026-10-20' },
  garmin_get_sleep_summaries: {
    args: { startDate: '2026-10-01', endDate: '2026-10-20' },
    url: '/sleep-service/sleep/dailySleepSummariesByDate?startDate=2026-10-01&endDate=2026-10-20',
  },
  garmin_get_heart_rate: { args: { date: '2026-10-20' }, url: '/wellness-service/wellness/dailyHeartRate?date=2026-10-20' },
  garmin_get_heart_rate_zones: { args: { generateDefaults: false }, url: '/biometric-service/heartRateZones/v2?generateDefaults=false' },
  garmin_get_hrv: { args: { calendarDate: '2026-10-20' }, url: '/hrv-service/hrv/2026-10-20' },
  garmin_get_hrv_summaries: { args: { fromDate: '2026-09-01', toDate: '2026-10-20' }, url: '/hrv-service/hrv/daily/2026-09-01/2026-10-20' },
  garmin_get_body_battery: {
    args: { startDate: '2026-10-19', endDate: '2026-10-20', chunks: 4 },
    url: '/wellness-service/wellness/bodyBattery/reports/daily?startDate=2026-10-19&endDate=2026-10-20&chunks=4',
  },
  garmin_get_spo2: { args: { calendarDate: '2026-10-20' }, url: '/wellness-service/wellness/daily/spo2acclimation/2026-10-20' },
  garmin_get_fitness_age: { args: { calendarDate: '2026-10-20' }, url: '/fitnessage-service/fitnessage/v2/2026-10-20' },
  garmin_get_weight_entries: { args: { startDate: '2026-10-01', endDate: '2026-10-20' }, url: '/weight-service/weight/all/2026-10-01/2026-10-20' },
  garmin_get_weight_summary: {
    args: { startDate: '2026-10-01', endDate: '2026-10-20', includeAll: true },
    url: '/weight-service/weight/range/2026-10-01/2026-10-20?includeAll=true',
  },
  garmin_get_weight_goals: {
    args: { startDate: '2026-01-01', endDate: '2026-12-31' },
    url: '/goal-service/goal/user/effective/weightgoal/2026-01-01/2026-12-31',
  },
  garmin_get_nutrition_log: {
    args: { date: '2026-10-20', includeMedia: false },
    url: '/nutrition-service/food/logs/2026-10-20?includeMedia=false',
  },
  garmin_get_menstrual_cycle_summary: {
    args: { calendarDate: '2026-10-20' },
    url: '/periodichealth-service/menstrualcycle/summary/2026-10-20',
  },
  garmin_get_menstrual_cycle_day: {
    args: { calendarDate: '2026-10-20', todayDate: '2026-10-23', includeAnalysis: true },
    url: '/periodichealth-service/menstrualcycle/dayview/2026-10-20?todayDate=2026-10-23&includeAnalysis=true',
  },
};

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function connect(onData: (call: RecordedCall) => Response, options: { downloadDir?: string } = {}) {
  const garmin = mockGarmin(onData);
  const ctx = createToolContext(
    { apiKey: 'test-key', baseUrl: BASE_URL, downloadDir: options.downloadDir },
    { fetch: garmin.fetch, allowDownloadDir: Boolean(options.downloadDir) },
  );
  const server = createGarminServer(ctx);
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  close = async () => {
    await client.close();
    await server.close();
  };
  return { client, garmin };
}

function textOf(result: { content?: unknown }): string {
  const [first] = (result.content ?? []) as { type: string; text?: string }[];
  return first?.text ?? '';
}

describe('tool registry', () => {
  it('covers every endpoint of the Personal API spec exactly once', () => {
    expect(allTools.map((t) => t.endpoint).sort()).toEqual([...SPEC_ENDPOINTS].sort());
    expect(new Set(allTools.map((t) => t.name)).size).toBe(allTools.length);
  });

  it('has a test case for every tool', () => {
    expect(Object.keys(CASES).sort()).toEqual(allTools.map((t) => t.name).sort());
  });

  it('lists all tools over MCP with descriptions and read-only annotations', async () => {
    const { client } = await connect(() => json({}));
    const { tools } = await client.listTools();

    expect(tools).toHaveLength(26);
    for (const tool of tools) {
      expect(tool.name).toMatch(/^garmin_[a-z0-9_]+$/);
      expect(tool.description?.length ?? 0).toBeGreaterThan(80);
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.destructiveHint).toBe(false);
      expect(tool.inputSchema.type).toBe('object');
    }
  });
});

describe('tool calls', () => {
  for (const [name, { args, url }] of Object.entries(CASES)) {
    it(`${name} calls ${url.split('?')[0]}`, async () => {
      const { client, garmin } = await connect(() =>
        name === 'garmin_download_activity_file'
          ? new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'application/zip' } })
          : json({ ok: name }),
      );

      const result = await client.callTool({ name, arguments: args });

      expect(result.isError ?? false).toBe(false);
      expect(garmin.dataCalls().map((c) => c.url)).toEqual([BASE_URL + url]);
    });
  }

  it('returns Garmin JSON as text', async () => {
    const { client } = await connect(() => json({ displayName: 'runner' }));
    const result = await client.callTool({ name: 'garmin_get_user_settings', arguments: {} });
    expect(JSON.parse(textOf(result))).toEqual({ displayName: 'runner' });
  });

  it('turns 204 into a friendly noData result', async () => {
    const { client } = await connect(() => new Response(null, { status: 204 }));
    const result = await client.callTool({ name: 'garmin_get_hrv', arguments: { calendarDate: '2026-10-20' } });
    expect(result.isError ?? false).toBe(false);
    expect(JSON.parse(textOf(result))).toMatchObject({ noData: true });
  });

  it('defaults todayDate for the menstrual day view', async () => {
    const { client, garmin } = await connect(() => json({}));
    await client.callTool({ name: 'garmin_get_menstrual_cycle_day', arguments: { calendarDate: '2026-10-20' } });
    expect(garmin.dataCalls()[0]?.url).toMatch(/\?todayDate=\d{4}-\d{2}-\d{2}$/);
  });

  it('surfaces Garmin errors as isError results', async () => {
    const { client } = await connect(() => new Response('No activity', { status: 404 }));
    const result = await client.callTool({ name: 'garmin_get_activity', arguments: { activityId: 1 } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Not found \(404/);
  });
});

describe('validation before calling Garmin', () => {
  const rejected: [string, Record<string, unknown>, RegExp][] = [
    ['garmin_get_steps', { startDate: '2026-10-01', endDate: '2026-10-29' }, /at most 28 days.*29 days/],
    ['garmin_get_stress', { startDate: '2026-09-01', endDate: '2026-10-01' }, /at most 28 days/],
    ['garmin_get_sleep_summaries', { startDate: '2026-09-01', endDate: '2026-10-02' }, /at most 31 days/],
    ['garmin_get_body_battery', { startDate: '2026-09-01', endDate: '2026-10-02' }, /at most 31 days/],
    ['garmin_get_hydration', { startDate: '2026-09-01', endDate: '2026-10-02' }, /at most 31 days/],
    ['garmin_get_daily_summaries', { startDate: '2025-01-01', endDate: '2026-10-01' }, /at most 366 days/],
    ['garmin_get_weight_entries', { startDate: '2026-10-10', endDate: '2026-10-01' }, /before the start date/],
    ['garmin_search_activities', { upperLatitude: 50 }, /all four bounds/],
  ];

  for (const [name, args, message] of rejected) {
    it(`${name} rejects ${JSON.stringify(args)}`, async () => {
      const { client, garmin } = await connect(() => json({}));
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(message);
      expect(garmin.calls).toHaveLength(0);
    });
  }

  it('rejects malformed dates through the input schema', async () => {
    const { client, garmin } = await connect(() => json({}));
    const result = await client.callTool({ name: 'garmin_get_sleep', arguments: { date: '20/10/2026' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/YYYY-MM-DD/);
    expect(garmin.calls).toHaveLength(0);
  });
});

describe('garmin_download_activity_file', () => {
  const zip = () => new Response(new Uint8Array([80, 75, 3, 4]), { headers: { 'content-type': 'application/zip' } });

  it('returns the file inline as a base64 resource by default', async () => {
    const { client } = await connect(zip);
    const result = await client.callTool({ name: 'garmin_download_activity_file', arguments: { activityId: 7 } });
    const resource = (result.content as { type: string; resource?: { blob?: string; mimeType?: string } }[])[1];
    expect(resource?.type).toBe('resource');
    expect(resource?.resource?.mimeType).toBe('application/zip');
    expect(Buffer.from(resource?.resource?.blob ?? '', 'base64')).toEqual(Buffer.from([80, 75, 3, 4]));
  });

  it('saves to GARMIN_DOWNLOAD_DIR when configured (stdio)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'garmin-mcp-'));
    const { client } = await connect(zip, { downloadDir: dir });
    const result = await client.callTool({ name: 'garmin_download_activity_file', arguments: { activityId: 7 } });
    expect(textOf(result)).toContain(join(dir, 'activity-7.zip'));
    expect(await readFile(join(dir, 'activity-7.zip'))).toEqual(Buffer.from([80, 75, 3, 4]));
  });
});

describe('date schema', () => {
  it('rejects impossible dates like 2026-02-30', async () => {
    const { client, garmin } = await connect(() => json({}));
    const result = await client.callTool({ name: 'garmin_get_hrv', arguments: { calendarDate: '2026-02-30' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Not a real calendar date/);
    expect(garmin.calls).toHaveLength(0);
  });
});
