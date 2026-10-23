import { z } from 'zod';
import { seg } from '../garmin/client.js';
import { jsonTool } from './define.js';
import { date } from './schemas.js';

export const getMenstrualCycleSummary = jsonTool({
  name: 'garmin_get_menstrual_cycle_summary',
  title: 'Get menstrual cycle summary',
  endpoint: 'GET /periodichealth-service/menstrualcycle/summary/{calendarDate}',
  description:
    'Women\'s health: get the menstrual cycle that contains a date: cycle start/end, dayInCycle, currentPhase and days until the next phase, ' +
    'period length, predicted cycle length, fertile window, predicted ovulation date, and pregnancy info (due date, week) when pregnancy tracking is on. ' +
    'Only has data if the user tracks their cycle in Garmin Connect.',
  inputSchema: z.object({ calendarDate: date('Any date inside the cycle of interest.') }),
  request: ({ calendarDate }) => ({ path: `/periodichealth-service/menstrualcycle/summary/${seg(calendarDate)}` }),
});

export const getMenstrualCycleDay = jsonTool({
  name: 'garmin_get_menstrual_cycle_day',
  title: 'Get menstrual cycle day view',
  endpoint: 'GET /periodichealth-service/menstrualcycle/dayview/{calendarDate}',
  description:
    "Women's health: detailed view of one day: the user's daily log (flow, symptoms, mood and other entries), the cycle summary for that day, " +
    'and, during pregnancy tracking, weekly weight goal ranges and optionally baby movement (kick count) data.',
  inputSchema: z.object({
    calendarDate: date('The day to fetch.'),
    todayDate: date(
      "The current date from the user's point of view, used as the reference for predictions. " +
        "Defaults to today: the local date when running locally, the UTC date when hosted, so pass it explicitly if you know the user's date.",
    ).optional(),
    reducedResponse: z.boolean().optional().describe('Return a lighter payload. Default false.'),
    skipbm: z.boolean().optional().describe('Exclude baby movement (kick count) data. Default false.'),
    includeAnalysis: z.boolean().optional().describe('Include cycle analysis data. Default false.'),
  }),
  request: ({ calendarDate, todayDate, ...rest }, ctx) => ({
    path: `/periodichealth-service/menstrualcycle/dayview/${seg(calendarDate)}`,
    query: { todayDate: todayDate ?? ctx.today(), ...rest },
  }),
});

export const womensHealthTools = [getMenstrualCycleSummary, getMenstrualCycleDay];
