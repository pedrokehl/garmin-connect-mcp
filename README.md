# Garmin Connect MCP

[![MCP](https://img.shields.io/badge/MCP-2026--07--28-blue)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)

An [MCP](https://modelcontextprotocol.io) server for the official **[Garmin Connect Personal API](https://developer.garmin.com/gc-developer-program/personal/personal-api)**.
It lets Claude, Cursor or any other MCP client read **your own** Garmin data, including activities, sleep, HRV, Body Battery, stress, steps, heart rate, SpO2, weight, nutrition and women's health.

- **All 26 endpoints** of the Personal API, one read-only tool each, with descriptions that state units, limits and when to use each tool.
- **Your API key stays in an environment variable.** The server exchanges it for Garmin's 24h access token and refreshes the token automatically.
- **Run it locally** over stdio (most private), or **deploy it for free** on Vercel and other serverless hosts behind a bearer token.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fpedrokehl%2Fgarmin-connect-mcp&env=GARMIN_API_KEY,MCP_AUTH_TOKEN&envDescription=GARMIN_API_KEY%3A%20your%20Garmin%20Connect%20Personal%20API%20key.%20MCP_AUTH_TOKEN%3A%20a%20random%20secret%20of%2024%2B%20characters%20that%20clients%20send%20as%20a%20bearer%20token.&envLink=https%3A%2F%2Fgithub.com%2Fpedrokehl%2Fgarmin-connect-mcp%23configuration&project-name=garmin-connect-mcp&repository-name=garmin-connect-mcp)

> This is an unofficial, community project. It is not affiliated with or endorsed by Garmin. Garmin and Garmin Connect are trademarks of Garmin Ltd. or its subsidiaries.

---

## Contents

- [What you can ask](#what-you-can-ask)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Run locally (stdio)](#run-locally-stdio)
- [Deploy for free](#deploy-for-free)
- [Connect a client to a deployed server](#connect-a-client-to-a-deployed-server)
- [Tool reference](#tool-reference)
- [API limits and behavior](#api-limits-and-behavior)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

## What you can ask

- "How did I sleep this week compared to last week? Any link with my HRV?"
- "Summarize my last five runs: pace, heart rate, elevation."
- "Plot my resting heart rate and Body Battery for October."
- "Which days this month did I miss my step goal?"
- "Download the FIT file of yesterday's ride."
- "What's my Fitness Age and what would improve it?"

## Quick start

### 1. Create your Garmin Personal API key

1. Sign in to [Garmin Connect](https://connect.garmin.com) on the web.
2. Open **[Settings → Personal API Token](https://connect.garmin.com/app/settings/personalApiToken)**.
3. Select **Create Key**, accept the terms, and choose an expiration: 30 days, 90 days, 180 days or 1 year.
4. **Copy the key right away.** Garmin shows it only once. If you lose it, delete it and create a new one.

Garmin emails you about a week before the key expires. Deleting the key on the same page revokes it immediately.

### 2. Install

```bash
git clone https://github.com/pedrokehl/garmin-connect-mcp.git
```

```bash
cd garmin-connect-mcp && npm install && npm run build
```

### 3. Add it to your MCP client

See [Run locally](#run-locally-stdio) for Claude Desktop, Claude Code and Cursor. To reach it from anywhere (phone, web), see [Deploy for free](#deploy-for-free).

## Configuration

All configuration is done with environment variables. Copy [`.env.example`](.env.example) to `.env` for local development. `.env` is git-ignored.

| Variable | Required | Used by | Description |
|---|---|---|---|
| `GARMIN_API_KEY` | **Yes** | stdio + HTTP | Your Garmin Connect Personal API key. |
| `MCP_AUTH_TOKEN` | **Yes, for HTTP** | HTTP | Shared secret that clients must send as `Authorization: Bearer <token>`. At least 24 characters. Generate one with `openssl rand -base64 32`. The HTTP server refuses every request if it is missing. |
| `GARMIN_API_BASE_URL` | No | both | Override the API host. Default: `https://personal.connectapi.garmin.com`. |
| `GARMIN_DOWNLOAD_DIR` | No | stdio only | If set, `garmin_download_activity_file` saves files to this folder (supports `~`) and returns the path instead of returning the file inline. |

## Run locally (stdio)

Running locally is the most private option: your data goes only from Garmin to your machine to your MCP client. In the examples below, replace `/path/to/garmin-connect-mcp` with the folder you cloned into.

### Claude Code

```bash
claude mcp add garmin -e GARMIN_API_KEY=your-key -- node /path/to/garmin-connect-mcp/dist/src/stdio.js
```

### Claude Desktop

Edit `claude_desktop_config.json` (Settings → Developer → Edit Config):

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

### Cursor

Add the same block to `~/.cursor/mcp.json`, or to `.cursor/mcp.json` in a project.

### Without cloning

`npx` can build and run it straight from GitHub. The first run takes a moment.

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

## Deploy for free

The HTTP entrypoint ([`src/http.ts`](src/http.ts)) is a web-standard `Request → Response` handler. It runs on any serverless platform that supports the Fetch API. Every option below has a free tier that is enough for one person's usage.

> **Privacy note:** when you deploy, your Garmin data passes through the hosting provider's infrastructure. The endpoint is protected only by `MCP_AUTH_TOKEN`, so treat that token like a password.

### Vercel (recommended, wired up)

Vercel's **Hobby** plan is free and meant for personal, non-commercial projects. That matches the Personal API terms, which cover your own data only.

**One click:** use the **Deploy with Vercel** button at the top of this page. It forks the repo and asks for `GARMIN_API_KEY` and `MCP_AUTH_TOKEN`.

**From the CLI:**

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

Your endpoint is `https://<project>.vercel.app/mcp` (or `/api/mcp`).

Notes:
- [`api/mcp.ts`](api/mcp.ts) is the Vercel Function. [`vercel.json`](vercel.json) sets `maxDuration: 60` and rewrites `/mcp` to it.
- Use the **production** domain. On Vercel, preview deployments are behind Vercel Authentication by default.
- After rotating your Garmin key, update `GARMIN_API_KEY` and redeploy. The cached token is per instance and expires with the old key.
- Inline file downloads are capped at about 3 MB because of Vercel's 4.5 MB response limit. Larger FIT/ZIP files need the local server with `GARMIN_DOWNLOAD_DIR`.

### Cloudflare Workers (free: 100k requests/day)

Create `worker.ts` in the repo root:

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

### Netlify Functions (free tier)

Create `netlify/functions/mcp.mts`:

```ts
import { createHttpHandler } from '../../src/http.js';

export default createHttpHandler();
export const config = { path: '/mcp' };
```

Set `GARMIN_API_KEY` and `MCP_AUTH_TOKEN` under **Site configuration → Environment variables**, then deploy.

### Deno Deploy (free tier)

```ts
import { createHttpHandler } from './src/http.ts';

Deno.serve(createHttpHandler({ env: Deno.env.toObject() }));
```

The Cloudflare, Netlify and Deno snippets reuse the same handler, but the automated tests here exercise only the Vercel entrypoint and stdio.

## Connect a client to a deployed server

Clients need the URL and the bearer header. In the examples below, replace `https://your-app.vercel.app/mcp` with your endpoint.

**Claude Code**

```bash
claude mcp add --transport http garmin https://your-app.vercel.app/mcp --header "Authorization: Bearer YOUR_MCP_AUTH_TOKEN"
```

**Claude Desktop / Cursor** (via [`mcp-remote`](https://www.npmjs.com/package/mcp-remote)):

```json
{
  "mcpServers": {
    "garmin": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://your-app.vercel.app/mcp", "--header", "Authorization:${GARMIN_MCP_AUTH}"],
      "env": { "GARMIN_MCP_AUTH": "Bearer YOUR_MCP_AUTH_TOKEN" }
    }
  }
}
```

**Cursor (native HTTP)**: `{"mcpServers":{"garmin":{"url":"https://your-app.vercel.app/mcp","headers":{"Authorization":"Bearer YOUR_MCP_AUTH_TOKEN"}}}}`

**claude.ai custom connectors** need OAuth, which this server does not implement yet. Use the local server or a client that supports custom headers.

## Tool reference

Every tool is read-only (`readOnlyHint: true`). Dates are `YYYY-MM-DD` in the user's **local** calendar. Ranges are inclusive. Results are Garmin's JSON as-is. When nothing was recorded, the result is `{"noData": true, ...}`, which is not an error.

### Profile

| Tool | What it returns | Inputs |
|---|---|---|
| `garmin_get_user_settings` | Display name, time zone, locale, unit system, formats, hydration/glucose units, training days. Call it first to learn the user's time zone and units. | none |

### Activities

| Tool | What it returns | Inputs |
|---|---|---|
| `garmin_search_activities` | List of activity summaries (ID, name, type, start time, distance m, durations s, elevation m, speed m/s, HR, power, cadence, calories). | `start`, `limit` (default 20), `startDate`, `endDate`, `search`, `activityType`, `activitySubType`, `excludedActivitySubType[]`, `eventType`, `favorite`, `excludeChildren`, `sortBy`, `sortOrder`, min/max `Distance`/`Duration`/`ElapsedDuration`/`Elevation`, `minAvgPower`, bounding box (`upperLatitude`, `lowerLatitude`, `leftLongitude`, `rightLongitude`), dive filters (`lowerMaxDepth`, `upperMaxDepth`, `minBottomTime`, `maxBottomTime`, `decoDive`), `requiredField[]` |
| `garmin_get_activity` | Full detail of one activity: metadata, summary metrics, splits/laps, device, dive/multisport info. | `activityId` |
| `garmin_get_activity_workouts` | Structured workouts followed during the activity (steps, targets). | `activityId` |
| `garmin_download_activity_file` | Original device file (ZIP containing the FIT file): inline base64 resource (≤ 3 MB), or saved to `GARMIN_DOWNLOAD_DIR`. | `activityId` |

### Daily wellness

| Tool | What it returns | Inputs / limit |
|---|---|---|
| `garmin_get_daily_summary` | Everything for one day: calories, steps, distance, floors, intensity minutes, HR, stress, Body Battery, SpO2, respiration. | `calendarDate` |
| `garmin_get_daily_summaries` | Daily summaries for a range (`{ data: [...] }`). | `startDate`, `endDate` (≤ 1 year) |
| `garmin_get_steps` | Steps, distance (m) and step goal per day. | `startDate`, `endDate` (≤ 28 days) |
| `garmin_get_stress` | Overall stress level and rest/low/medium/high durations (s) per day. | `startDate`, `endDate` (≤ 28 days) |
| `garmin_get_hydration` | Water intake, goal, sweat loss (ml) per day. | `startDate`, `endDate` (≤ 31 days) |
| `garmin_get_wellness_activities` | Non-fitness sessions (breathwork, meditation, relaxation…). | `fromDate`, `untilDate` |

### Sleep

| Tool | What it returns | Inputs / limit |
|---|---|---|
| `garmin_get_sleep` | One night: sleep window, deep/light/REM/awake seconds, scores, SpO2, respiration, HR, stress. | `date` (the morning you woke up) |
| `garmin_get_sleep_summaries` | One sleep summary per night. | `startDate`, `endDate` (≤ 31 days) |

### Heart, recovery and fitness

| Tool | What it returns | Inputs / limit |
|---|---|---|
| `garmin_get_heart_rate` | Resting/min/max HR, 7-day resting average, abnormal-HR alerts, all-day HR time series. | `date` |
| `garmin_get_heart_rate_zones` | HR zone floors (bpm) and training method per sport. | `generateDefaults` |
| `garmin_get_hrv` | Overnight HRV summary (status, baseline, weekly/last-night average) and 5-minute readings. | `calendarDate` |
| `garmin_get_hrv_summaries` | HRV summary per day, for trends. | `fromDate`, `toDate` |
| `garmin_get_body_battery` | Body Battery charged/drained, time series, events. | `startDate`, `endDate` (≤ 31 days), `chunks` |
| `garmin_get_spo2` | Pulse Ox averages, lows, hourly values, acclimation. | `calendarDate` |
| `garmin_get_fitness_age` | Fitness Age, achievable age and the components behind it. | `calendarDate`, `fullHistoryScan` |

### Body composition

| Tool | What it returns | Inputs |
|---|---|---|
| `garmin_get_weight_entries` | Every weigh-in: weight (kg), BMI, body fat %, water %, bone/muscle mass, visceral fat, metabolic age. | `startDate`, `endDate` |
| `garmin_get_weight_summary` | Latest weigh-in per day, range average, nearest weigh-ins before/after. | `startDate`, `endDate`, `includeAll` |
| `garmin_get_weight_goals` | Effective weight goals (target in **grams**) and goal ranges. | `startDate`, `endDate` |

### Nutrition

| Tool | What it returns | Inputs |
|---|---|---|
| `garmin_get_nutrition_log` | Food log: goals, calorie and nutrient totals, foods and meals. | `date`, `includeGoals`, `includeNutrition`, `includeMedia`, `mealId` |

### Women's health

| Tool | What it returns | Inputs |
|---|---|---|
| `garmin_get_menstrual_cycle_summary` | Cycle containing the date: phase, day in cycle, predicted ovulation, fertile window, pregnancy info. | `calendarDate` |
| `garmin_get_menstrual_cycle_day` | Day log (flow, symptoms, mood), cycle summary, pregnancy weight goals / kick counts. | `calendarDate`, `todayDate` (defaults to today, UTC), `reducedResponse`, `skipbm`, `includeAnalysis` |

## API limits and behavior

What Garmin documents, and what this server adds on top:

- **Auth flow:** `POST /personalapitoken-service/personal-api/personal-api-key/token` with `Authorization: ApiKey <key>` returns a JWT access token. It is valid for 24h, or until the key expires if that comes first. There are no refresh tokens. The server caches the token in memory, requests a new one when less than an hour is left, and retries once on `401`.
- **Range limits** (checked before calling Garmin, with a clear error): steps and stress 28 days; hydration, sleep summaries and Body Battery 31 days; daily summaries 1 year.
- **Read-only, pull-only, your own data only.** There are no webhooks and no workout upload: Garmin's Training API is not part of the Personal tier.
- **Rate limits** are not published. Prefer range endpoints over many single-day calls.
- **Not for commercial, multi-user apps.** That is Garmin's rule for the Personal API.
- **Units:** distances in meters, durations in seconds, speeds in m/s, weigh-ins in kg, weight goals in grams, hydration in ml.

Official references: [Personal API overview](https://developer.garmin.com/gc-developer-program/personal/personal-api), [FAQ](https://developer.garmin.com/gc-developer-program/personal/personal-faq/), [OpenAPI docs](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/), and Garmin's [Python reference client](https://github.com/garmin/connect-personal-api-python).

## Security

- The Garmin key is read only from the environment. It is never logged, never returned by a tool, and never included in error messages.
- The HTTP server **fails closed**. Without an `MCP_AUTH_TOKEN` of at least 24 characters it answers `500` to everything. With one, any request without the correct `Authorization: Bearer` header gets `401`. Tokens are compared in constant time.
- Every tool is read-only, and nothing is persisted server-side except the in-memory access token.
- Rotate regularly: pick a shorter key expiry, and rotate `MCP_AUTH_TOKEN` if it might have leaked.
- Health data is sensitive. Prefer the local stdio server when you can.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Garmin refused the Personal API key (401 …)` | Key wrong, expired or deleted. Create a new one at [Personal API Token](https://connect.garmin.com/app/settings/personalApiToken) and update `GARMIN_API_KEY`. |
| HTTP `401 Missing or invalid bearer token` | The client isn't sending `Authorization: Bearer <MCP_AUTH_TOKEN>`, or the token differs from the deployed one. |
| HTTP `500 Server not configured` | `MCP_AUTH_TOKEN` or `GARMIN_API_KEY` missing on the host. Set it and redeploy. |
| `{"noData": true}` | Nothing recorded for that date, or your device doesn't support the metric (HRV, SpO2, Body Battery…). |
| `This endpoint accepts at most N days` | Split the range. The model usually does this by itself after reading the error. |
| `too large to return inline` | Use the local server with `GARMIN_DOWNLOAD_DIR`. |
| Server exits with `GARMIN_API_KEY is not set` | Add `GARMIN_API_KEY` to the `env` block of your client config. |

## Development

```bash
npm install
```

```bash
npm test
```

```bash
npm run typecheck
```

- `npm run dev`: run the stdio server from source (needs `GARMIN_API_KEY` in your shell).
- `npm run inspector`: open the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) against the stdio server.
- `npm run smoke`: live check against the real API using `GARMIN_API_KEY` from `.env`. It prints only response shapes, never your data.
- `npx vercel dev`: run the HTTP endpoint locally at `http://localhost:3000/mcp`.

Project layout and conventions for contributors (and coding agents) are in [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE) © Pedro Kehl
