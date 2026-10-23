import type { CallToolResult } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import type { GarminClient, JsonResult, Query } from '../garmin/client.js';

export interface ToolContext {
  client: GarminClient;
  /** Today's date (YYYY-MM-DD) where the server runs: local time for stdio, UTC when hosted. */
  today: () => string;
  /** Stdio only: saves a downloaded file and returns its path (GARMIN_DOWNLOAD_DIR). */
  saveFile?: (filename: string, bytes: Uint8Array) => Promise<string>;
}

export interface GarminRequest {
  path: string;
  query?: Query;
}

interface ToolBase<S extends z.ZodObject> {
  /** snake_case, prefixed with `garmin_`. */
  name: string;
  title: string;
  /** What it returns, units, limits, and when to prefer another tool. */
  description: string;
  inputSchema: S;
  /** The Garmin endpoint this tool wraps, for docs and tests (`GET /path/{param}`). */
  endpoint: string;
  /** Return an error message to reject the call before hitting Garmin. */
  validate?: (args: z.infer<S>) => string | undefined;
}

/** A tool that maps 1:1 to a JSON GET endpoint. */
export interface JsonTool<S extends z.ZodObject = z.ZodObject> extends ToolBase<S> {
  kind: 'json';
  request: (args: z.infer<S>, ctx: ToolContext) => GarminRequest;
}

/** A tool with custom handling (e.g. binary download). */
export interface CustomTool<S extends z.ZodObject = z.ZodObject> extends ToolBase<S> {
  kind: 'custom';
  run: (args: z.infer<S>, ctx: ToolContext) => Promise<CallToolResult>;
}

export type GarminTool = JsonTool<any> | CustomTool<any>;

export function jsonTool<S extends z.ZodObject>(tool: Omit<JsonTool<S>, 'kind'>): JsonTool<S> {
  return { kind: 'json', ...tool };
}

export function customTool<S extends z.ZodObject>(tool: Omit<CustomTool<S>, 'kind'>): CustomTool<S> {
  return { kind: 'custom', ...tool };
}

const NO_DATA_MESSAGE =
  'Garmin returned no data for this request: nothing was recorded for these dates, or the feature is not used or not supported by the device.';

/** The standard tool result for a JSON response: Garmin's data as-is, or a friendly noData marker. */
export function jsonResult(result: JsonResult): CallToolResult {
  const payload = result.noData ? { noData: true, message: NO_DATA_MESSAGE } : result.data;
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}
