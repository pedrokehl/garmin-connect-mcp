import { z } from 'zod';
import { seg } from '../garmin/client.js';
import { jsonTool } from './define.js';
import { checkRange, date, endDate, startDate } from './schemas.js';

export const getHeartRate = jsonTool({
  name: 'garmin_get_heart_rate',
  title: 'Get all-day heart rate (one day)',
  endpoint: 'GET /wellness-service/wellness/dailyHeartRate',
  description:
    'Get heart rate for one day: restingHeartRate, minHeartRate, maxHeartRate, lastSevenDaysAvgRestingHeartRate, abnormal-HR alerts, ' +
    'and `heartRateValues`, a time series of [timestamp, bpm] rows whose columns are described by heartRateValueDescriptors. ' +
    'The time series is large; for resting HR trends over many days prefer garmin_get_daily_summaries.',
  inputSchema: z.object({ date: date('The day to fetch.') }),
  request: ({ date }) => ({ path: '/wellness-service/wellness/dailyHeartRate', query: { date } }),
});

export const getHeartRateZones = jsonTool({
  name: 'garmin_get_heart_rate_zones',
  title: 'Get heart rate zones',
  endpoint: 'GET /biometric-service/heartRateZones/v2',
  description:
    "Get the user's heart rate zone configuration, one entry per sport (default, running, cycling…): training method " +
    '(%max HR, %HRR or %LTHR), zone1Floor..zone5Floor (bpm), and the max, resting and lactate threshold heart rates used.',
  inputSchema: z.object({
    generateDefaults: z
      .boolean()
      .optional()
      .describe('Generate default zones when the user has none configured. Garmin default: true.'),
  }),
  request: ({ generateDefaults }) => ({ path: '/biometric-service/heartRateZones/v2', query: { generateDefaults } }),
});

export const getHrv = jsonTool({
  name: 'garmin_get_hrv',
  title: 'Get heart rate variability (one night)',
  endpoint: 'GET /hrv-service/hrv/{calendarDate}',
  description:
    'Get overnight HRV for one date: `hrvSummary` (weeklyAvg, lastNightAvg, lastNight5MinHigh, baseline, status: NONE, POOR, LOW, UNBALANCED, BALANCED or INVALID, feedbackPhrase) ' +
    'and `hrvReadings` (5-minute HRV values in ms during sleep), plus the sleep window timestamps. Requires a compatible watch worn overnight.',
  inputSchema: z.object({ calendarDate: date('The date of the morning after the night measured.') }),
  request: ({ calendarDate }) => ({ path: `/hrv-service/hrv/${seg(calendarDate)}` }),
});

export const getHrvSummaries = jsonTool({
  name: 'garmin_get_hrv_summaries',
  title: 'Get HRV daily summaries (date range)',
  endpoint: 'GET /hrv-service/hrv/daily/{fromDate}/{toDate}',
  description:
    'Get one HRV summary per day for a date range (weeklyAvg, lastNightAvg, baseline, status, feedback), without the 5-minute readings. ' +
    'Use for HRV trends and recovery analysis.',
  inputSchema: z.object({ fromDate: startDate(), toDate: endDate() }),
  validate: ({ fromDate, toDate }) => checkRange(fromDate, toDate),
  request: ({ fromDate, toDate }) => ({ path: `/hrv-service/hrv/daily/${seg(fromDate)}/${seg(toDate)}` }),
});

export const getBodyBattery = jsonTool({
  name: 'garmin_get_body_battery',
  title: 'Get Body Battery (date range)',
  endpoint: 'GET /wellness-service/wellness/bodyBattery/reports/daily',
  description:
    'Get Body Battery (energy level 0–100) per day: charged and drained totals, a time series `bodyBatteryValuesArray`, ' +
    'feedback events and the activities that impacted it. Maximum range: 31 days. ' +
    'Set `chunks` to get the lowest and highest values of each part of the day instead of reading the full series.',
  inputSchema: z.object({
    startDate: startDate(),
    endDate: endDate('The range may span at most 31 days, counting both ends.'),
    chunks: z.coerce
      .number()
      .int()
      .min(1)
      .max(96)
      .optional()
      .describe('Split each day into this many intervals and report the min/max Body Battery of each (e.g. 4 = every 6 hours).'),
  }),
  validate: ({ startDate, endDate }) => checkRange(startDate, endDate, 31),
  request: ({ startDate, endDate, chunks }) => ({
    path: '/wellness-service/wellness/bodyBattery/reports/daily',
    query: { startDate, endDate, chunks },
  }),
});

export const getSpo2 = jsonTool({
  name: 'garmin_get_spo2',
  title: 'Get blood oxygen / SpO2 (one day)',
  endpoint: 'GET /wellness-service/wellness/daily/spo2acclimation/{calendarDate}',
  description:
    'Get Pulse Ox (SpO2, %) for one day: averageSpO2, lowestSpO2, latestSpO2, lastSevenDaysAvgSpO2, avgSleepSpO2, ' +
    'single readings and hourly averages, plus altitude acclimation data. Requires a watch with Pulse Ox enabled.',
  inputSchema: z.object({ calendarDate: date('The day to fetch.') }),
  request: ({ calendarDate }) => ({ path: `/wellness-service/wellness/daily/spo2acclimation/${seg(calendarDate)}` }),
});

export const getFitnessAge = jsonTool({
  name: 'garmin_get_fitness_age',
  title: 'Get Fitness Age',
  endpoint: 'GET /fitnessage-service/fitnessage/v2/{calendarDate}',
  description:
    'Get the latest Fitness Age as of a date: chronologicalAge, fitnessAge, achievableFitnessAge, previousFitnessAge, ' +
    'and the components behind it (BMI or body fat, resting heart rate, vigorous activity days/minutes) with improvement targets.',
  inputSchema: z.object({
    calendarDate: date('Reference date; the latest Fitness Age available on or before it is returned.'),
    fullHistoryScan: z
      .boolean()
      .optional()
      .describe('Search the whole history for the latest value (Garmin default: true). If false, only the 28 days before calendarDate are considered.'),
  }),
  request: ({ calendarDate, fullHistoryScan }) => ({
    path: `/fitnessage-service/fitnessage/v2/${seg(calendarDate)}`,
    query: { fullHistoryScan },
  }),
});

export const heartTools = [getHeartRate, getHeartRateZones, getHrv, getHrvSummaries, getBodyBattery, getSpo2, getFitnessAge];
