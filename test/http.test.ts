import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createHttpHandler } from '../src/http.js';
import { BASE_URL, json, mockGarmin } from './helpers.js';

const TOKEN = 'a-very-long-random-test-token-1234567890';
const URL_ = 'https://example.vercel.app/api/mcp';

function handler(env: Record<string, string | undefined> = {}) {
  const garmin = mockGarmin(() => json({ displayName: 'runner' }));
  const handle = createHttpHandler({
    env: { GARMIN_API_KEY: 'key', GARMIN_API_BASE_URL: BASE_URL, MCP_AUTH_TOKEN: TOKEN, ...env },
    fetch: garmin.fetch,
  });
  return { handle, garmin };
}

const listTools = (authorization?: string) =>
  new Request(URL_, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(authorization ? { authorization } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });

let client: Client | undefined;
afterEach(async () => {
  await client?.close();
  client = undefined;
});

describe('HTTP auth', () => {
  it('refuses every request when MCP_AUTH_TOKEN is not set (fails closed)', async () => {
    const { handle } = handler({ MCP_AUTH_TOKEN: undefined });
    const response = await handle(listTools(`Bearer ${TOKEN}`));
    expect(response.status).toBe(500);
    expect(await response.text()).toMatch(/MCP_AUTH_TOKEN/);
  });

  it('refuses a weak MCP_AUTH_TOKEN', async () => {
    const { handle } = handler({ MCP_AUTH_TOKEN: 'short' });
    expect((await handle(listTools('Bearer short'))).status).toBe(500);
  });

  it('returns 401 without a bearer token', async () => {
    const { handle, garmin } = handler();
    const response = await handle(listTools());
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toMatch(/^Bearer/);
    expect(garmin.calls).toHaveLength(0);
  });

  it('returns 401 with the wrong bearer token', async () => {
    const { handle } = handler();
    expect((await handle(listTools(`Bearer ${TOKEN}x`))).status).toBe(401);
  });

  it('reports a missing GARMIN_API_KEY after authentication', async () => {
    const { handle } = handler({ GARMIN_API_KEY: undefined });
    const response = await handle(listTools(`Bearer ${TOKEN}`));
    expect(response.status).toBe(500);
    expect(await response.text()).toMatch(/GARMIN_API_KEY/);
  });
});

describe('HTTP MCP end to end', () => {
  async function connect(token = TOKEN) {
    const { handle, garmin } = handler();
    client = new Client({ name: 'http-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(URL_), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
      fetch: (url, init) => handle(new Request(url, init)),
    });
    await client.connect(transport);
    return { client, garmin };
  }

  it('lists the 26 tools', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(26);
  });

  it('calls Garmin and reuses the access token across requests', async () => {
    const { client, garmin } = await connect();

    const first = await client.callTool({ name: 'garmin_get_user_settings', arguments: {} });
    await client.callTool({ name: 'garmin_get_user_settings', arguments: {} });

    expect((first.content as { text: string }[])[0]?.text).toBe('{"displayName":"runner"}');
    expect(garmin.tokenCalls()).toHaveLength(1);
    expect(garmin.dataCalls()).toHaveLength(2);
  });
});
