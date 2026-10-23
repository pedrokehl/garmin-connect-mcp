import { z } from 'zod';
import { seg } from '../garmin/client.js';
import { GarminApiError } from '../garmin/errors.js';
import { customTool, jsonResult, jsonTool } from './define.js';
import { checkRange, endDate, startDate } from './schemas.js';

/**
 * Garmin's spec says kilograms, but the live API returns grams (verified Oct 2026:
 * every weight field is > 1000 for an adult). The descriptions state what the API returns.
 */
const WEIGHT_UNITS =
  'weight, boneMass and muscleMass are in GRAMS (75000 = 75 kg); bodyFat and bodyWater are percentages; timestampGMT and date are epoch milliseconds.';

export const getWeightEntries = customTool({
  name: 'garmin_get_weight_entries',
  title: 'Get all weight entries (date range)',
  endpoint: 'GET /weight-service/weight/all/{startDate}/{endDate}',
  description:
    'Get every individual weigh-in in a date range (from Index scales, other smart scales or manual entries): date, timestampGMT, weight, bmi, ' +
    `bodyFat, bodyWater, boneMass, muscleMass, visceralFat, metabolicAge, physiqueRating and weightDelta (change since the previous weigh-in); ${WEIGHT_UNITS} ` +
    'For one value per day plus the range average use garmin_get_weight_summary.',
  inputSchema: z.object({ startDate: startDate(), endDate: endDate() }),
  validate: ({ startDate, endDate }) => checkRange(startDate, endDate),
  run: async ({ startDate, endDate }, ctx) => {
    const range = `${seg(startDate)}/${seg(endDate)}`;
    try {
      return jsonResult(await ctx.client.getJson(`/weight-service/weight/all/${range}`));
    } catch (error) {
      if (!(error instanceof GarminApiError) || error.status !== 400) throw error;
    }
    // As of Oct 2026 Garmin answers 400 with an empty body to every documented request on
    // weight/all, even for dates that have weigh-ins. weight/range with includeAll returns the
    // same entries (same fields, plus samplePk and sourceType) grouped by day, so flatten those.
    const fallback = await ctx.client.getJson(`/weight-service/weight/range/${range}`, { includeAll: true });
    if (fallback.noData) return jsonResult(fallback);
    const days = (fallback.data as { dailyWeightSummaries?: { allWeightMetrics?: unknown[] }[] }).dailyWeightSummaries ?? [];
    return jsonResult({ noData: false, data: days.flatMap((day) => day.allWeightMetrics ?? []) });
  },
});

export const getWeightSummary = jsonTool({
  name: 'garmin_get_weight_summary',
  title: 'Get weight summary (date range)',
  endpoint: 'GET /weight-service/weight/range/{startDate}/{endDate}',
  description:
    'Get a weight summary for a date range: dailyWeightSummaries (latest weigh-in per day, or all of them with includeAll), ' +
    `totalAverage for the range, and the closest weigh-ins before (previousDateWeight) and after (nextDateWeight) the range; ${WEIGHT_UNITS}`,
  inputSchema: z.object({
    startDate: startDate(),
    endDate: endDate(),
    includeAll: z
      .boolean()
      .optional()
      .describe('Include every weigh-in of each day instead of only the latest one. Default false.'),
  }),
  validate: ({ startDate, endDate }) => checkRange(startDate, endDate),
  request: ({ startDate, endDate, includeAll }) => ({
    path: `/weight-service/weight/range/${seg(startDate)}/${seg(endDate)}`,
    query: { includeAll },
  }),
});

export const getWeightGoals = jsonTool({
  name: 'garmin_get_weight_goals',
  title: 'Get weight goals (date range)',
  endpoint: 'GET /goal-service/goal/user/effective/weightgoal/{startDate}/{endDate}',
  description:
    "Get the user's weight goals in effect during a date range: userGoals (goalValue = target weight in GRAMS, category such as MANUAL or PREGNANCY, " +
    'tracking period, start/end dates) and userGoalRanges (low/high target ranges, also in grams).',
  inputSchema: z.object({ startDate: startDate(), endDate: endDate() }),
  validate: ({ startDate, endDate }) => checkRange(startDate, endDate),
  request: ({ startDate, endDate }) => ({
    path: `/goal-service/goal/user/effective/weightgoal/${seg(startDate)}/${seg(endDate)}`,
  }),
});

export const bodyTools = [getWeightEntries, getWeightSummary, getWeightGoals];
