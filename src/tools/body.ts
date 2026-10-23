import { z } from 'zod';
import { seg } from '../garmin/client.js';
import { jsonTool } from './define.js';
import { checkRange, endDate, startDate } from './schemas.js';

const WEIGHT_UNITS = 'weight is in kilograms; bodyFat and bodyWater are percentages.';

export const getWeightEntries = jsonTool({
  name: 'garmin_get_weight_entries',
  title: 'Get all weight entries (date range)',
  endpoint: 'GET /weight-service/weight/all/{startDate}/{endDate}',
  description:
    'Get every individual weigh-in in a date range (from Index scales, other smart scales or manual entries): date, timestampGMT, weight, bmi, ' +
    `bodyFat, bodyWater, boneMass, muscleMass, visceralFat, metabolicAge, physiqueRating and weightDelta (change since the previous weigh-in); ${WEIGHT_UNITS} ` +
    'For one value per day plus the range average use garmin_get_weight_summary.',
  inputSchema: z.object({ startDate: startDate(), endDate: endDate() }),
  validate: ({ startDate, endDate }) => checkRange(startDate, endDate),
  request: ({ startDate, endDate }) => ({ path: `/weight-service/weight/all/${seg(startDate)}/${seg(endDate)}` }),
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
    'tracking period, start/end dates) and userGoalRanges (low/high target ranges). Note: goals are in grams, while weigh-ins are in kilograms.',
  inputSchema: z.object({ startDate: startDate(), endDate: endDate() }),
  validate: ({ startDate, endDate }) => checkRange(startDate, endDate),
  request: ({ startDate, endDate }) => ({
    path: `/goal-service/goal/user/effective/weightgoal/${seg(startDate)}/${seg(endDate)}`,
  }),
});

export const bodyTools = [getWeightEntries, getWeightSummary, getWeightGoals];
