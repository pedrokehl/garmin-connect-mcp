#!/usr/bin/env node
/**
 * Local entrypoint: speaks MCP over stdin/stdout for Claude Desktop, Claude Code, Cursor, etc.
 * Reads GARMIN_API_KEY (and optionally GARMIN_DOWNLOAD_DIR) from the environment.
 */
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { ConfigError, loadGarminConfig } from './config.js';
import { createFileSaver } from './local-files.js';
import { createGarminServer, createToolContext } from './mcp-server.js';
import { localToday } from './tools/schemas.js';

try {
  const config = loadGarminConfig();
  const downloadDir = process.env.GARMIN_DOWNLOAD_DIR?.trim();
  const ctx = createToolContext(config, {
    // Runs on the user's machine, so the local date is the user's date.
    today: localToday,
    saveFile: downloadDir ? createFileSaver(downloadDir) : undefined,
  });
  serveStdio(() => createGarminServer(ctx), {
    // stdout carries the protocol, so diagnostics go to stderr.
    onerror: (error) => console.error(`[garmin-connect-mcp] ${error.message}`),
  });
} catch (error) {
  console.error(`[garmin-connect-mcp] ${error instanceof ConfigError ? error.message : String(error)}`);
  process.exit(1);
}
