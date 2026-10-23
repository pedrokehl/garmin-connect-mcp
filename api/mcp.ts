/**
 * Vercel Function: Streamable HTTP MCP endpoint at /api/mcp (also rewritten from /mcp).
 * Environment variables: GARMIN_API_KEY, MCP_AUTH_TOKEN (see README).
 */
import { createHttpHandler } from '../src/http.js';

const handle = createHttpHandler();

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
