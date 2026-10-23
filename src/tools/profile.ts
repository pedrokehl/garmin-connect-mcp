import { z } from 'zod';
import { jsonTool } from './define.js';

export const getUserSettings = jsonTool({
  name: 'garmin_get_user_settings',
  title: 'Get user profile settings',
  endpoint: 'GET /userprofile-service/userprofile/settings',
  description:
    "Get the user's Garmin Connect settings: displayName, timeZone, preferredLocale, measurementSystem (metric/statute), " +
    'first day of week, date/time/number formats, heart rate and power display formats, hydration and glucose units, golf units, ' +
    'wheelchair mode and preferred training days. Call this first to learn the user\'s time zone (so you know what "today" is) and preferred units.',
  inputSchema: z.object({}),
  request: () => ({ path: '/userprofile-service/userprofile/settings' }),
});

export const profileTools = [getUserSettings];
