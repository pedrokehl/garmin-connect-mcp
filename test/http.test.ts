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
  it('refuses every request when no auth method is configured (fails closed)', async () => {
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

describe('HTTP 2025-era clients (mcp-remote, Cursor)', () => {
  const legacy = (body: unknown) =>
    new Request(URL_, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify(body),
    });

  /** Responses may be plain JSON or a single SSE `data:` frame. */
  async function rpc(response: Response): Promise<{ result?: Record<string, unknown>; error?: unknown }> {
    const text = await response.text();
    const data = text.startsWith('{') ? text : (/^data: (.*)$/m.exec(text)?.[1] ?? '');
    return JSON.parse(data) as { result?: Record<string, unknown> };
  }

  it('serves initialize, tools/list and tools/call statelessly', async () => {
    const { handle, garmin } = handler();

    const init = await rpc(
      await handle(
        legacy({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mcp-remote', version: '1' } },
        }),
      ),
    );
    expect(init.result?.protocolVersion).toBe('2025-06-18');
    expect(init.result?.serverInfo).toMatchObject({
      name: 'garmin',
      title: 'Garmin',
      icons: [
        { src: 'https://example.vercel.app/icon.png', mimeType: 'image/png', sizes: ['256x256'] },
        { src: 'https://example.vercel.app/icon.svg', mimeType: 'image/svg+xml', sizes: ['any'] },
      ],
    });

    const list = await rpc(await handle(legacy({ jsonrpc: '2.0', id: 2, method: 'tools/list' })));
    expect((list.result?.tools as unknown[]).length).toBe(26);

    const call = await rpc(
      await handle(legacy({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'garmin_get_user_settings', arguments: {} } })),
    );
    expect((call.result?.content as { text: string }[])[0]?.text).toBe('{"displayName":"runner"}');
    expect(garmin.tokenCalls()).toHaveLength(1);
  });

  it('answers GET (2025 SSE stream) with 405 since serving is stateless', async () => {
    const { handle } = handler();
    const response = await handle(
      new Request(URL_, { method: 'GET', headers: { accept: 'text/event-stream', authorization: `Bearer ${TOKEN}`, 'mcp-protocol-version': '2025-06-18' } }),
    );
    expect(response.status).toBe(405);
  });
});
