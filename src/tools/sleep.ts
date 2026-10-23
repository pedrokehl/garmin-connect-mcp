import { z } from 'zod';
import { jsonTool } from './define.js';
import { checkRange, date, endDate, startDate } from './schemas.js';

const SLEEP_FIELDS =
  'sleep start/end timestamps, sleepTimeSeconds, deepSleepSeconds, lightSleepSeconds, remSleepSeconds, awakeSleepSeconds, awakeCount, ' +
  'napTimeSeconds, sleep scores and feedback, average/lowest SpO2, respiration, avgHeartRate and avgSleepStress';

export const getSleep = jsonTool({
  name: 'garmin_get_sleep',
  title: 'Get sleep (one night)',
  endpoint: 'GET /sleep-service/sleep/dailySleep',
  description:
    `Get sleep data for one calendar date (the night ending on that morning): ${SLEEP_FIELDS}. ` +
    'Durations are in seconds. For several nights use garmin_get_sleep_summaries.',
  inputSchema: z.object({ date: date('The date of the morning you woke up.') }),
  request: ({ date }) => ({ path: '/sleep-service/sleep/dailySleep', query: { date } }),
});

export const getSleepSummaries = jsonTool({
  name: 'garmin_get_sleep_summaries',
  title: 'Get sleep summaries (date range)',
  endpoint: 'GET /sleep-service/sleep/dailySleepSummariesByDate',
  description:
    `Get one sleep summary per night for a date range, each with ${SLEEP_FIELDS}. ` +
    'Durations are in seconds. Maximum range: 31 days per request.',
  inputSchema: z.object({ startDate: startDate(), endDate: endDate('The range may span at most 31 days, counting both ends.') }),
  validate: ({ startDate, endDate }) => checkRange(startDate, endDate, 31),
  request: ({ startDate, endDate }) => ({
    path: '/sleep-service/sleep/dailySleepSummariesByDate',
    query: { startDate, endDate },
  }),
});

export const sleepTools = [getSleep, getSleepSummaries];
