import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { seg } from '../garmin/client.js';
import { customTool, jsonTool } from './define.js';
import { activityId, checkRange, date } from './schemas.js';

/** Base64 inflates ~33%; keep inline downloads well under Vercel's 4.5 MB response limit. */
export const MAX_INLINE_DOWNLOAD_BYTES = 3 * 1024 * 1024;

const int = () => z.coerce.number().int();

export const searchActivities = jsonTool({
  name: 'garmin_search_activities',
  title: 'Search activities',
  endpoint: 'GET /activitylist-service/activities/search/activities',
  description: [
    "Search and list the user's recorded activities (runs, rides, swims, strength sessions, hikes, dives…), newest first by default.",
    'Returns an array of activity summaries with: activityId, activityName, description, startTimeLocal/startTimeGMT, activityType, eventType,',
    'distance (meters), duration / movingDuration / elapsedDuration (seconds), elevationGain/Loss (meters), averageSpeed/maxSpeed (m/s),',
    'calories, averageHR/maxHR (bpm), cadence, power, training effect and more.',
    'Use this first to find activity IDs, then call garmin_get_activity for splits and full detail, or garmin_download_activity_file for the original FIT file.',
    'All filters are optional and combined with AND. Paginate with `start` and `limit`.',
  ].join(' '),
  inputSchema: z.object({
    start: int().min(0).optional().describe('Zero-based offset of the first activity to return, for pagination. Default 0.'),
    limit: int()
      .min(1)
      .max(1000)
      .default(20)
      .describe('Maximum number of activities to return. Default 20 here (Garmin itself defaults to 99). Keep it small to save context.'),
    startDate: date('Only activities that started on or after this local date.').optional(),
    endDate: date('Only activities that started on or before this local date.').optional(),
    search: z.string().optional().describe('Free text matched against activity names and descriptions.'),
    activityType: z
      .string()
      .optional()
      .describe('Parent activity type key, e.g. running, cycling, swimming, walking, hiking, fitness_equipment, diving. Must be a parent type, not a subtype.'),
    activitySubType: z
      .string()
      .optional()
      .describe('Activity subtype key, e.g. trail_running or treadmill_running (with activityType=running), road_cycling or indoor_cycling (with activityType=cycling).'),
    excludedActivitySubType: z.array(z.string()).optional().describe('Subtype keys to exclude, e.g. ["treadmill_running"].'),
    eventType: z
      .string()
      .optional()
      .describe('Event classification key: race, training, recreation, fitness, specialEvent or uncategorized.'),
    favorite: z
      .union([z.literal(-1), z.literal(0), z.literal(1)])
      .optional()
      .describe('1 = only favorites, 0 = only non-favorites, -1 = no filter (default).'),
    excludeChildren: z
      .boolean()
      .optional()
      .describe('Exclude child activities of a multisport activity (e.g. the swim/bike/run legs of a triathlon). Garmin default: true.'),
    sortBy: z
      .string()
      .optional()
      .describe('Field to sort by, e.g. startLocal (default), name, distance, duration, elevationGain, calories.'),
    sortOrder: z.enum(['asc', 'desc']).optional().describe('Sort direction. Default desc (newest/largest first).'),
    minDistance: int().min(0).optional().describe('Minimum distance in meters (inclusive).'),
    maxDistance: int().min(0).optional().describe('Maximum distance in meters (inclusive).'),
    minDuration: int().min(0).optional().describe('Minimum timer (moving) duration in seconds (inclusive).'),
    maxDuration: int().min(0).optional().describe('Maximum timer (moving) duration in seconds (inclusive).'),
    minElapsedDuration: int().min(0).optional().describe('Minimum elapsed duration including pauses, in seconds.'),
    maxElapsedDuration: int().min(0).optional().describe('Maximum elapsed duration including pauses, in seconds.'),
    minElevation: int().min(0).optional().describe('Minimum total elevation gain in meters.'),
    maxElevation: int().min(0).optional().describe('Maximum total elevation gain in meters.'),
    minAvgPower: int().min(0).optional().describe('Minimum average power in watts.'),
    upperLatitude: z.number().min(-90).max(90).optional().describe('Bounding box (start location) north edge, decimal degrees. Provide all four bounds.'),
    lowerLatitude: z.number().min(-90).max(90).optional().describe('Bounding box south edge, decimal degrees. Provide all four bounds.'),
    leftLongitude: z.number().min(-180).max(180).optional().describe('Bounding box west edge, decimal degrees. Provide all four bounds.'),
    rightLongitude: z.number().min(-180).max(180).optional().describe('Bounding box east edge, decimal degrees. Provide all four bounds.'),
    lowerMaxDepth: int().min(0).optional().describe('Dives only: minimum of the max depth, in centimeters.'),
    upperMaxDepth: int().min(0).optional().describe('Dives only: maximum of the max depth, in centimeters.'),
    minBottomTime: int().min(0).optional().describe('Dives only: minimum bottom time in seconds.'),
    maxBottomTime: int().min(0).optional().describe('Dives only: maximum bottom time in seconds.'),
    decoDive: z.boolean().optional().describe('Dives only: true = decompression dives, false = non-decompression dives.'),
    requiredField: z
      .array(z.string())
      .optional()
      .describe('Only return activities where all of these fields are non-null, e.g. ["averageHR", "avgPower"].'),
  }),
  validate: (args) => {
    const bbox = [args.upperLatitude, args.lowerLatitude, args.leftLongitude, args.rightLongitude];
    const set = bbox.filter((v) => v !== undefined).length;
    if (set > 0 && set < 4) {
      return 'The location filter needs all four bounds: upperLatitude, lowerLatitude, leftLongitude and rightLongitude.';
    }
    if (args.startDate && args.endDate) return checkRange(args.startDate, args.endDate);
    return undefined;
  },
  request: (args) => ({ path: '/activitylist-service/activities/search/activities', query: { ...args } }),
});

export const getActivity = jsonTool({
  name: 'garmin_get_activity',
  title: 'Get activity details',
  endpoint: 'GET /activity-service/activity/{activityId}',
  description: [
    'Get the full detail of one activity: name, type, event type, time zone, device and metadata, the summary',
    '(distance m, duration s, speeds m/s, heart rate, power, cadence, calories, training effect, elevation),',
    'split/lap summaries, and dive or multisport info when relevant.',
    'Get the activityId from garmin_search_activities. Does not include per-second samples; use garmin_download_activity_file for the raw FIT data.',
  ].join(' '),
  inputSchema: z.object({ activityId }),
  request: ({ activityId }) => ({ path: `/activity-service/activity/${seg(activityId)}` }),
});

export const getActivityWorkouts = jsonTool({
  name: 'garmin_get_activity_workouts',
  title: 'Get workouts performed in an activity',
  endpoint: 'GET /activity-service/activity/{activityId}/workouts',
  description:
    'List the structured workouts that were followed during an activity (workout name, sport, steps with targets, creation time). ' +
    'Returns an empty array when the activity was not a structured workout.',
  inputSchema: z.object({ activityId }),
  request: ({ activityId }) => ({ path: `/activity-service/activity/${seg(activityId)}/workouts` }),
});

export const downloadActivityFile = customTool({
  name: 'garmin_download_activity_file',
  title: 'Download original activity file (FIT)',
  endpoint: 'GET /download-service/files/activity/{activityId}',
  description: [
    'Download the original file recorded by the device for an activity, usually a ZIP containing the .FIT file with every sample',
    '(GPS track, heart rate, power, cadence…).',
    'When running locally with GARMIN_DOWNLOAD_DIR set, the file is saved there and the path is returned.',
    `Otherwise the file is returned inline as a base64 embedded resource, up to ${MAX_INLINE_DOWNLOAD_BYTES / 1024 / 1024} MB.`,
    'For summaries, splits or metrics, prefer garmin_get_activity: it is much smaller.',
  ].join(' '),
  inputSchema: z.object({ activityId }),
  run: async ({ activityId: id }, ctx) => {
    const file = await ctx.client.getBinary(`/download-service/files/activity/${seg(id)}`);
    const ext = file.contentType.includes('zip') ? 'zip' : file.contentType.includes('fit') ? 'fit' : 'bin';
    const filename = file.filename ?? `activity-${id}.${ext}`;
    const size = `${(file.bytes.byteLength / 1024).toFixed(1)} KB`;

    if (ctx.downloadDir) {
      await mkdir(ctx.downloadDir, { recursive: true });
      const target = join(ctx.downloadDir, filename.replace(/[/\\]/g, '_'));
      await writeFile(target, file.bytes);
      return { content: [{ type: 'text', text: `Saved activity ${id} (${file.contentType}, ${size}) to ${target}` }] };
    }

    if (file.bytes.byteLength > MAX_INLINE_DOWNLOAD_BYTES) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text:
              `The file for activity ${id} is ${size}, too large to return inline. ` +
              'Run the server locally (stdio) with GARMIN_DOWNLOAD_DIR set to save it to disk instead.',
          },
        ],
      };
    }

    return {
      content: [
        { type: 'text', text: `Activity ${id} original file: ${filename} (${file.contentType}, ${size}).` },
        {
          type: 'resource',
          resource: {
            uri: `garmin://activities/${id}/file/${encodeURIComponent(filename)}`,
            mimeType: file.contentType,
            blob: Buffer.from(file.bytes).toString('base64'),
          },
        },
      ],
    };
  },
});

export const activityTools = [searchActivities, getActivity, getActivityWorkouts, downloadActivityFile];
