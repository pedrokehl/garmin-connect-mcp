import type { CallToolResult, McpServer, StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import { describeError } from '../garmin/errors.js';
import { activityTools } from './activities.js';
import { bodyTools } from './body.js';
import { dailyTools } from './daily.js';
import { jsonResult, type GarminTool, type ToolContext } from './define.js';
import { heartTools } from './heart.js';
import { nutritionTools } from './nutrition.js';
import { profileTools } from './profile.js';
import { sleepTools } from './sleep.js';
import { womensHealthTools } from './womens-health.js';

/** Every Garmin Connect Personal API endpoint, one tool each. */
export const allTools: GarminTool[] = [
  ...profileTools,
  ...activityTools,
  ...dailyTools,
  ...sleepTools,
  ...heartTools,
  ...bodyTools,
  ...nutritionTools,
  ...womensHealthTools,
];

export function registerAllTools(server: McpServer, ctx: ToolContext): void {
  for (const tool of allTools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: nullAsMissing(tool.inputSchema),
        annotations: {
          title: tool.title,
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      (args: unknown) => runTool(tool, args, ctx),
    );
  }
}

/**
 * Models often send `null` for "not set". Accept that by dropping top-level null
 * fields before validation, while advertising plain optional fields: a
 * `["string", "null"]` type in the JSON schema is less portable across clients
 * (e.g. providers that only accept a single `type`).
 */
export function nullAsMissing<S extends StandardSchemaWithJSON>(schema: S): S {
  const standard = schema['~standard'];
  return {
    '~standard': {
      ...standard,
      jsonSchema: standard.jsonSchema,
      validate: (value: unknown) => standard.validate(dropNullFields(value)),
    },
  } as S;
}

function dropNullFields(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== null));
}

/** Validate, call Garmin, and shape the result. Never throws: failures become `isError` results. */
export async function runTool(tool: GarminTool, args: unknown, ctx: ToolContext): Promise<CallToolResult> {
  const problem = tool.validate?.(args as never);
  if (problem) return errorResult(problem);
  try {
    if (tool.kind === 'custom') return await tool.run(args as never, ctx);
    const { path, query } = tool.request(args as never, ctx);
    return jsonResult(await ctx.client.getJson(path, query));
  } catch (error) {
    return errorResult(describeError(error));
  }
}

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}
