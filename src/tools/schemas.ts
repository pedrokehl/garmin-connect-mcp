import { z } from 'zod';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A calendar date in the user's local time, `YYYY-MM-DD`. */
export function date(description: string) {
  return z
    .string()
    .regex(ISO_DATE, 'Use the YYYY-MM-DD format, e.g. 2026-10-23.')
    .refine(isRealDate, 'Not a real calendar date.')
    .describe(`${description} Format YYYY-MM-DD, in the user's local calendar.`);
}

export const startDate = (extra = '') => date(`First day of the range (inclusive).${extra ? ` ${extra}` : ''}`);
export const endDate = (extra = '') => date(`Last day of the range (inclusive).${extra ? ` ${extra}` : ''}`);

/**
 * Strict integer. Deliberately not `z.coerce`: coercion turns `null`, `""` and `false`
 * into 0 and `true` into 1, which silently changes what is sent to Garmin.
 */
export const integer = () => z.number().int();

/** Activity IDs are int64; accept a JSON number or a string of digits, nothing else. */
export const activityId = z
  .union([z.number().int().positive(), z.string().regex(/^\d+$/, 'Activity IDs contain digits only.')])
  .describe('Numeric Garmin activity ID, as returned in `activityId` by garmin_search_activities.');

function isRealDate(value: string): boolean {
  const time = Date.parse(`${value}T00:00:00Z`);
  // Date.parse rolls 2026-02-30 over to March; a round trip catches that.
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/** Number of days in an inclusive date range. */
export function daysInclusive(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS) + 1;
}

/** Validate an inclusive date range against Garmin's documented maximum (in days). */
export function checkRange(start: string, end: string, maxDays?: number): string | undefined {
  const days = daysInclusive(start, end);
  if (days < 1) return `The end date (${end}) is before the start date (${start}).`;
  if (maxDays !== undefined && days > maxDays) {
    return `This endpoint accepts at most ${maxDays} days per request, but ${start}..${end} spans ${days} days. Split the range into chunks of ${maxDays} days or fewer.`;
  }
  return undefined;
}

/** Today's date in UTC as YYYY-MM-DD (hosted servers, where the user's time zone is unknown). */
export function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Today's date in the machine's local time zone as YYYY-MM-DD (stdio, which runs on the user's machine). */
export function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
