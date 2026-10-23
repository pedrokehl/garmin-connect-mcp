import { McpServer } from '@modelcontextprotocol/server';
import type { GarminConfig } from './config.js';
import { TokenManager } from './garmin/auth.js';
import { GarminClient } from './garmin/client.js';
import type { ToolContext } from './tools/define.js';
import { serverIcons } from './icon.js';
import { registerAllTools } from './tools/index.js';
import { utcToday } from './tools/schemas.js';

/** Internal name: log prefixes and the HTTP auth realm. */
export const SERVER_NAME = 'garmin-connect-mcp';
/** What MCP clients show for this server. */
export const DISPLAY_NAME = 'Garmin';
export const SERVER_VERSION = '0.1.0';

const INSTRUCTIONS = `Read-only access to the user's own Garmin Connect data through the official Garmin Connect Personal API.
- Dates are calendar dates (YYYY-MM-DD) in the user's local time zone. If you don't know the user's time zone or "today", call garmin_get_user_settings first.
- Several range endpoints have a maximum span (steps and stress 28 days; hydration, sleep summaries and Body Battery 31 days; daily summaries 365 days). Split longer periods into several calls.
- To analyse workouts, find IDs with garmin_search_activities, then call garmin_get_activity.
- Distances are in meters, durations in seconds, speeds in m/s, all body weights (weigh-ins, bone/muscle mass, weight goals) in GRAMS.
- A result of {"noData": true} means nothing was recorded, not an error.`;

/**
 * Build the long-lived pieces (token cache + HTTP client) once per process,
 * so the 24h Garmin token is reused across MCP requests.
 */
export function createToolContext(
  config: GarminConfig,
  options: { fetch?: typeof fetch } & Partial<Pick<ToolContext, 'today' | 'saveFile'>> = {},
): ToolContext {
  const tokens = new TokenManager({ apiKey: config.apiKey, baseUrl: config.baseUrl, fetch: options.fetch });
  const client = new GarminClient({ baseUrl: config.baseUrl, tokens, fetch: options.fetch });
  return { client, today: options.today ?? utcToday, saveFile: options.saveFile };
}

/**
 * A fresh MCP server with every Garmin tool registered. Cheap: safe to call per request.
 * `publicOrigin` (HTTP only) lets clients load the hosted icon from this deployment.
 */
export function createGarminServer(ctx: ToolContext, options: { publicOrigin?: string } = {}): McpServer {
  const server = new McpServer(
    {
      name: 'garmin',
      title: DISPLAY_NAME,
      version: SERVER_VERSION,
      description: 'Read-only access to your own Garmin Connect data: activities, sleep, HRV, Body Battery, stress, steps, heart rate, weight and more.',
      websiteUrl: 'https://github.com/pedrokehl/garmin-connect-mcp',
      icons: serverIcons(options.publicOrigin),
    },
    { instructions: INSTRUCTIONS },
  );
  registerAllTools(server, ctx);
  return server;
}
