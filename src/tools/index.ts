import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import { activityTools } from './activities.js';
import { bodyTools } from './body.js';
import { dailyTools } from './daily.js';
import type { GarminTool, ToolContext } from './define.js';
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

const NO_DATA_MESSAGE =
  'Garmin returned no data for this request: nothing was recorded for these dates, or the feature is not used or not supported by the device.';

export function registerAllTools(server: McpServer, ctx: ToolContext): void {
  for (const tool of allTools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
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

/** Validate, call Garmin, and shape the result. Never throws: failures become `isError` results. */
export async function runTool(tool: GarminTool, args: unknown, ctx: ToolContext): Promise<CallToolResult> {
  const problem = tool.validate?.(args as never);
  if (problem) return errorResult(problem);
  try {
    if (tool.kind === 'custom') return await tool.run(args as never, ctx);
    const { path, query } = tool.request(args as never);
    const result = await ctx.client.getJson(path, query);
    const payload = result.noData ? { noData: true, message: NO_DATA_MESSAGE } : result.data;
    return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}
