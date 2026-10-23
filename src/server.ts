import { McpServer } from '@modelcontextprotocol/server';
import type { GarminConfig } from './config.js';
import { TokenManager } from './garmin/auth.js';
import { GarminClient } from './garmin/client.js';
import type { ToolContext } from './tools/define.js';
import { registerAllTools } from './tools/index.js';

export const SERVER_NAME = 'garmin-connect-mcp';
export const SERVER_VERSION = '0.1.0';

const INSTRUCTIONS = `Read-only access to the user's own Garmin Connect data through the official Garmin Connect Personal API.
- Dates are calendar dates (YYYY-MM-DD) in the user's local time zone. If you don't know the user's time zone or "today", call garmin_get_user_settings first.
- Several range endpoints have a maximum span (steps and stress 28 days; hydration, sleep summaries and Body Battery 31 days; daily summaries 1 year). Split longer periods into several calls.
- To analyse workouts, find IDs with garmin_search_activities, then call garmin_get_activity.
- Distances are in meters, durations in seconds, speeds in m/s, weigh-ins in kilograms, weight goals in grams.
- A result of {"noData": true} means nothing was recorded, not an error.`;

/**
 * Build the long-lived pieces (token cache + HTTP client) once per process,
 * so the 24h Garmin token is reused across MCP requests.
 */
export function createToolContext(config: GarminConfig, options: { fetch?: typeof fetch; allowDownloadDir?: boolean } = {}): ToolContext {
  const tokens = new TokenManager({ apiKey: config.apiKey, baseUrl: config.baseUrl, fetch: options.fetch });
  const client = new GarminClient({ baseUrl: config.baseUrl, tokens, fetch: options.fetch });
  return { client, downloadDir: options.allowDownloadDir ? config.downloadDir : undefined };
}

/** A fresh MCP server with every Garmin tool registered. Cheap: safe to call per request. */
export function createGarminServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
  registerAllTools(server, ctx);
  return server;
}
