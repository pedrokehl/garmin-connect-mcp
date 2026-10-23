import { z } from 'zod';
import { seg } from '../garmin/client.js';
import { jsonTool } from './define.js';
import { checkRange, date, endDate, startDate } from './schemas.js';

export const getDailySummary = jsonTool({
  name: 'garmin_get_daily_summary',
  title: 'Get daily wellness summary (one day)',
  endpoint: 'GET /usersummary-service/usersummary/daily',
  description: [
    "Get the user's complete wellness summary for one day: total/active/BMR kilocalories, steps and step goal, distance (meters),",
    'floors climbed, intensity minutes (moderate/vigorous) and goal, highly active/active/sedentary/sleeping seconds,',
    'min/max/resting heart rate, stress averages and durations, Body Battery charged/drained/highest/lowest, SpO2 and respiration.',
    'Best single call for "how was my day?". For many days at once use garmin_get_daily_summaries.',
  ].join(' '),
  inputSchema: z.object({ calendarDate: date('The day to summarize.') }),
  request: ({ calendarDate }) => ({ path: '/usersummary-service/usersummary/daily', query: { calendarDate } }),
});

export const getDailySummaries = jsonTool({
  name: 'garmin_get_daily_summaries',
  title: 'Get daily wellness summaries (date range)',
  endpoint: 'GET /usersummary-service/v2/dailysummaries',
  description: [
    'Get daily wellness summaries (steps, calories, distance, intensity minutes, heart rate, stress, Body Battery, floors…) for every day in a range,',
    'returned as `{ data: [...] }` with one entry per day.',
    'Maximum range: 365 days (Garmin documents 1 year). Each day is a large object, so a year of data is very long:',
    'prefer a few weeks or months per call unless the whole year is needed. For one day garmin_get_daily_summary is simpler.',
  ].join(' '),
  inputSchema: z.object({ startDate: startDate(), endDate: endDate('The range may span at most 365 days, counting both ends.') }),
  validate: ({ startDate, endDate }) => checkRange(startDate, endDate, 365),
  request: ({ startDate, endDate }) => ({ path: '/usersummary-service/v2/dailysummaries', query: { startDate, endDate } }),
});

export const getSteps = jsonTool({
  name: 'garmin_get_steps',
  title: 'Get daily steps (date range)',
  endpoint: 'GET /usersummary-service/stats/steps/daily/{startDate}/{endDate}',
  description:
    'Get daily step totals for a date range: one entry per day with calendarDate, totalSteps, totalDistance (meters) and stepGoal. ' +
    'Maximum range: 28 days per request; split longer periods, or use garmin_get_daily_summaries (up to 365 days), which also includes steps.',
  inputSchema: z.object({ startDate: startDate(), endDate: endDate('The range may span at most 28 days, counting both ends.') }),
  validate: ({ startDate, endDate }) => checkRange(startDate, endDate, 28),
  request: ({ startDate, endDate }) => ({
    path: `/usersummary-service/stats/steps/daily/${seg(startDate)}/${seg(endDate)}`,
  }),
});

export const getStress = jsonTool({
  name: 'garmin_get_stress',
  title: 'Get daily stress (date range)',
  endpoint: 'GET /usersummary-service/stats/stress/daily/{startDate}/{endDate}',
  description:
    'Get daily stress statistics for a date range: one entry per day with calendarDate and a `values` map containing overallStressLevel (0–100) ' +
    'and restStressDuration, lowStressDuration, mediumStressDuration, highStressDuration (seconds). Stress is derived from heart rate variability. ' +
    'Maximum range: 28 days per request.',
  inputSchema: z.object({ startDate: startDate(), endDate: endDate('The range may span at most 28 days, counting both ends.') }),
  validate: ({ startDate, endDate }) => checkRange(startDate, endDate, 28),
  request: ({ startDate, endDate }) => ({
    path: `/usersummary-service/stats/stress/daily/${seg(startDate)}/${seg(endDate)}`,
  }),
});

export const getHydration = jsonTool({
  name: 'garmin_get_hydration',
  title: 'Get daily hydration (date range)',
  endpoint: 'GET /usersummary-service/stats/hydration/daily/{startDate}/{endDate}',
  description:
    'Get logged water intake per day: calendarDate, valueInML (consumed), goalInML, sweatLossInML (estimated from activities), ' +
    'activityIntakeInML and lastEntryTimestampLocal. Only has data if the user logs hydration in Garmin Connect. Maximum range: 31 days.',
  inputSchema: z.object({ startDate: startDate(), endDate: endDate('The range may span at most 31 days, counting both ends.') }),
  validate: ({ startDate, endDate }) => checkRange(startDate, endDate, 31),
  request: ({ startDate, endDate }) => ({
    path: `/usersummary-service/stats/hydration/daily/${seg(startDate)}/${seg(endDate)}`,
  }),
});

export const getWellnessActivities = jsonTool({
  name: 'garmin_get_wellness_activities',
  title: 'Get wellness activity summaries (date range)',
  endpoint: 'GET /wellnessactivity-service/activity/summary/range/{fromDate}/{untilDate}',
  description:
    'Get wellness activities (e.g. breathwork, meditation, relaxation and other non-fitness sessions recorded on the device) for a date range: ' +
    'name, type, notes, start/end timestamps, summary values and time in zones. Both dates are inclusive. ' +
    'Fitness activities such as runs or rides are not here; use garmin_search_activities for those.',
  inputSchema: z.object({ fromDate: startDate(), untilDate: endDate() }),
  validate: ({ fromDate, untilDate }) => checkRange(fromDate, untilDate),
  request: ({ fromDate, untilDate }) => ({
    path: `/wellnessactivity-service/activity/summary/range/${seg(fromDate)}/${seg(untilDate)}`,
  }),
});

export const dailyTools = [getDailySummary, getDailySummaries, getSteps, getStress, getHydration, getWellnessActivities];
