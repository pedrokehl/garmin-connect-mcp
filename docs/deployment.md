# Running and deploying

The [README](../README.md) covers the one-click Vercel setup. This page covers everything else: running locally, deploying Vercel from the CLI, other hosts, and troubleshooting.

- [Configuration](#configuration)
- [Run locally (stdio)](#run-locally-stdio)
- [Vercel from the CLI](#vercel-from-the-cli)
- [Other hosts](#other-hosts): Cloudflare Workers, Netlify Functions, Deno Deploy
- [Troubleshooting](#troubleshooting)

## Configuration

All configuration is done with environment variables. For local development, copy [`.env.example`](../.env.example) to `.env`; `.env` is git-ignored.

| Variable | Required | Used by | Description |
|---|---|---|---|
| `GARMIN_API_KEY` | **Yes** | stdio + HTTP | Your Garmin Connect Personal API key. |
| `MCP_AUTH_TOKEN` | **Yes, for HTTP** | HTTP | Shared secret that clients must send as `Authorization: Bearer <token>`. At least 24 characters; generate one with `openssl rand -base64 32`. Without it the HTTP server refuses every request. |
| `MCP_OAUTH_CLIENT_SECRET` | For OAuth clients | HTTP | Enables the built-in OAuth sign-in (the Gemini app, claude.ai). At least 24 characters. Enter it in the app together with the client ID `garmin-mcp`. |
| `MCP_OAUTH_CLIENT_ID` | No | HTTP | Overrides the OAuth client ID (default `garmin-mcp`). Only takes effect with a client secret set. |
| `MCP_OAUTH_REDIRECT_URIS` | No | HTTP | Extra allowed OAuth callback URLs, comma-separated. claude.ai's, Gemini Enterprise's and loopback (`http://localhost:*`) callbacks are allowed by default. |
| `GARMIN_API_BASE_URL` | No | both | Override the API host. Default: `https://personal.connectapi.garmin.com`. |
| `GARMIN_DOWNLOAD_DIR` | No | stdio only | If set, `garmin_download_activity_file` saves files to this folder (supports `~`) and returns the path instead of returning the file inline. |

## Run locally (stdio)

Running locally is the most private option: your data goes only from Garmin to your machine to your MCP client.

```bash
git clone https://github.com/pedrokehl/garmin-connect-mcp.git
```

```bash
cd garmin-connect-mcp && npm install
```

`npm install` also builds the server. In the examples below, replace `/path/to/garmin-connect-mcp` with the folder you cloned into.

**Claude Code**

```bash
claude mcp add garmin -e GARMIN_API_KEY=your-key -- node /path/to/garmin-connect-mcp/dist/src/stdio.js
```

**Claude Desktop**: edit `claude_desktop_config.json` (Settings → Developer → Edit Config). **Cursor**: add the same block to `~/.cursor/mcp.json`.

```json
{
  "mcpServers": {
    "garmin": {
      "command": "node",
      "args": ["/path/to/garmin-connect-mcp/dist/src/stdio.js"],
      "env": {
        "GARMIN_API_KEY": "your-key",
        "GARMIN_DOWNLOAD_DIR": "~/Downloads/garmin"
      }
    }
  }
}
```

**Without cloning:** `npx` can build and run it straight from GitHub. The first run takes a moment.

```json
{
  "mcpServers": {
    "garmin": {
      "command": "npx",
      "args": ["-y", "github:pedrokehl/garmin-connect-mcp"],
      "env": { "GARMIN_API_KEY": "your-key" }
    }
  }
}
```

## Vercel from the CLI

The same deployment as the README's button, done from a terminal:

```bash
npm i -g vercel
```

```bash
vercel link
```

```bash
vercel env add GARMIN_API_KEY production
```

```bash
vercel env add MCP_AUTH_TOKEN production
```

```bash
vercel deploy --prod
```

Notes:
- [`api/mcp.ts`](../api/mcp.ts) is the Vercel Function. [`vercel.json`](../vercel.json) sets `maxDuration: 60`, rewrites `/mcp` to it, and serves [`public/`](../public/index.html), a small landing page at `/`. Vercel needs a static output folder even for function-only projects.
- Use the **production** domain. On Vercel, preview deployments are behind Vercel Authentication by default.
- Inline file downloads are capped at about 3 MB because of Vercel's 4.5 MB response limit. Larger FIT/ZIP files need the local server with `GARMIN_DOWNLOAD_DIR`.

## Other hosts

The HTTP entrypoint ([`src/http.ts`](../src/http.ts)) is a web-standard `Request → Response` handler, so it runs on any serverless platform that supports the Fetch API. Every option below has a free tier that is enough for one person. Clients connect the same way as described in the README, with your host's URL.

### Cloudflare Workers

Free tier: 100k requests/day. Create `worker.ts` in the repo root:

```ts
import { createHttpHandler } from './src/http.js';

let handle: ((request: Request) => Promise<Response>) | undefined;

export default {
  fetch(request: Request, env: Record<string, string>) {
    handle ??= createHttpHandler({ env });
    return handle(request);
  },
};
```

and a `wrangler.toml`:

```toml
name = "garmin-connect-mcp"
main = "worker.ts"
compatibility_date = "2026-10-01"
compatibility_flags = ["nodejs_compat"]
```

Then set the secrets and deploy:

```bash
npx wrangler secret put GARMIN_API_KEY
```

```bash
npx wrangler secret put MCP_AUTH_TOKEN
```

```bash
npx wrangler deploy
```

### Netlify Functions

Create `netlify/functions/mcp.mts`:

```ts
import { createHttpHandler } from '../../src/http.js';

export default createHttpHandler();
export const config = { path: '/mcp' };
```

Set `GARMIN_API_KEY` and `MCP_AUTH_TOKEN` under **Site configuration → Environment variables**, then deploy.

### Deno Deploy

Create `main.ts`:

```ts
import { createHttpHandler } from './src/http.ts';

Deno.serve(createHttpHandler({ env: Deno.env.toObject() }));
```

and a `deno.json`. The sources use Node-style `.js` import suffixes, which Deno only resolves with sloppy imports:

```json
{ "unstable": ["sloppy-imports"] }
```

Run it locally with `deno run --allow-env --allow-net --allow-read main.ts`, or deploy the folder to Deno Deploy with the two environment variables set.

### What has been verified

- `vercel build` succeeds, and the built function was exercised with real requests.
- The Deno setup above was run and called over HTTP with Deno 2.5.
- The unit tests run the shared handler in Node, and check that nothing it imports uses Node-only APIs.
- The Cloudflare and Netlify snippets use the same handler, but have not been deployed.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Garmin refused the Personal API key (401 …)` | Key wrong, expired or deleted. Create a new one at [Personal API Token](https://connect.garmin.com/app/settings/personalApiToken) and update `GARMIN_API_KEY`. |
| HTTP `401 Missing or invalid bearer token` | The client isn't sending `Authorization: Bearer <MCP_AUTH_TOKEN>`, or the token differs from the deployed one. |
| HTTP `500 Server not configured` | `MCP_AUTH_TOKEN` or `GARMIN_API_KEY` missing on the host. Set it and redeploy. |
| `{"noData": true}` | Nothing recorded for that date, or your device doesn't support the metric (HRV, SpO2, Body Battery…). |
| `This endpoint accepts at most N days` | Split the range. The model usually does this by itself after reading the error. |
| `too large to return inline` | Use the local server with `GARMIN_DOWNLOAD_DIR`. |
| `Garmin did not respond within 12 seconds` | Garmin is slow or down. Retry later, or ask for a smaller date range. |
| `Could not reach Garmin` | Network or DNS problem between the server and `personal.connectapi.garmin.com`. |
| `The token endpoint did not return a JWT` | Garmin answered the token request with something else, such as a maintenance page. Retry later. |
| OAuth page: `Redirect URL not allowed` | Add the URL shown on the page to `MCP_OAUTH_REDIRECT_URIS` and redeploy. |
| OAuth page: `Unknown client` | The client ID entered in the app isn't `garmin-mcp`, or isn't the value of `MCP_OAUTH_CLIENT_ID` if you set one. |
| Token request fails with `invalid_client` | The client secret entered in the app doesn't match `MCP_OAUTH_CLIENT_SECRET`. |
| An OAuth app suddenly asks to sign in again | `MCP_AUTH_TOKEN` or the client secret changed, which revokes all OAuth tokens, or the 30-day refresh token expired. |
| Server exits with `GARMIN_API_KEY is not set` | Add `GARMIN_API_KEY` to the `env` block of your client config. |
