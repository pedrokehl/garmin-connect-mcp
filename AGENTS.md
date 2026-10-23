# AGENTS.md

Guidance for coding agents (Claude Code, Codex, Cursor, …) and humans working on this repo. `CLAUDE.md` is a symlink to this file.

## What this is

An MCP server that wraps the official **Garmin Connect Personal API** (released Oct 2026). Each of its 26 GET endpoints is one read-only MCP tool. The server runs in two modes:

- **stdio** ([`src/stdio.ts`](src/stdio.ts)), for local desktop clients.
- **HTTP** ([`src/http.ts`](src/http.ts) → [`api/mcp.ts`](api/mcp.ts) on Vercel), behind a bearer token.

It is built on **MCP TypeScript SDK v2** (`@modelcontextprotocol/server`, spec 2026-07-28), not the v1 `@modelcontextprotocol/sdk` package. Before using an SDK API you haven't used here yet, check the v2 docs or `node_modules/@modelcontextprotocol/server/dist/*.d.mts`, because many v1 examples online no longer apply.

## Architecture

```
env ─► src/config.ts            loadGarminConfig(): GARMIN_API_KEY, GARMIN_API_BASE_URL, GARMIN_DOWNLOAD_DIR
         │
         ▼
src/garmin/auth.ts              TokenManager: key → JWT exchange (shape-checked), per-token refresh time, single-flight, invalidate(rejected)
src/garmin/client.ts            GarminClient: GET with Bearer, 401 → refresh + retry once, 204 → noData, query encoding,
                                getBinary with a streamed size cap (FileTooLargeError)
src/garmin/errors.ts            GarminApiError, describeError() (timeouts/network → readable text), GARMIN_TIMEOUT_MS (12s)
src/encoding.ts                 atob/btoa base64 helpers (no Buffer on the HTTP path)
         │
         ▼
src/tools/define.ts             jsonTool()/customTool() registry types
src/tools/schemas.ts            shared zod pieces: date(), startDate(), endDate(), activityId, checkRange()
src/tools/<area>.ts             tool definitions (profile, activities, daily, sleep, heart, body, nutrition, womens-health)
src/tools/index.ts              allTools[], registerAllTools(), runTool() (validate → call → shape, never throws)
         │
         ▼
src/mcp-server.ts               createToolContext() (long-lived: token cache, today(), optional saveFile) + createGarminServer() (cheap, per request)
         │
         ├─► src/stdio.ts       serveStdio(); local today(); saveFile from src/local-files.ts (the only Node-only module)
         └─► src/http.ts        createHttpHandler(): OAuth routes → auth gate (static token or OAuth access token)
                                → createMcpHandler(); web-standard Request → Response
                ├─► src/oauth/routes.ts  stateless single-user OAuth 2.0 server: discovery metadata, /oauth/authorize
                │                        (login page asking for MCP_AUTH_TOKEN), /oauth/token (codes, refresh)
                ├─► src/oauth/tokens.ts  HMAC-signed codes/tokens (gcm1.<claims>.<sig>), PKCE, constant-time compare
                ├─► src/oauth/page.ts    login/error HTML with CSP, frame-ancestors none, no-store
                └─► api/mcp.ts  Vercel Function (GET/POST/DELETE), vercel.json rewrites /mcp → /api/mcp,
                                outputDirectory public/ (required: Vercel fails the build without a static output folder)
```

The tool context is created **once per process** so the 24h Garmin token survives across requests. The `McpServer` itself is created per request (HTTP) or per connection (stdio).

## Commands

| Task | Command |
|---|---|
| Install | `npm install` (also builds, through `prepare`) |
| Build | `npm run build` (tsc → `dist/`) |
| Vercel build check (offline) | Create a git-ignored `.vercel/project.json` containing `{"projectId":"local","orgId":"local","settings":{"framework":null}}`, then run `npx vercel build`. It must print `Build completed successfully`. This does **not** run the production type-check described under "Stay on TypeScript 6" |
| Typecheck | `npm run typecheck` |
| Unit/integration tests | `npm test` (vitest, Garmin fully mocked, no network) |
| Run stdio from source | `GARMIN_API_KEY=… npm run dev` |
| MCP Inspector | `npm run inspector`, or a headless schema check: `npx @modelcontextprotocol/inspector --cli --strict -e GARMIN_API_KEY=x node dist/src/stdio.js --method tools/list`, which must print no warnings |
| Live smoke test | `npm run smoke` (needs a real key in `.env`; prints shapes only) |
| HTTP locally | `npx vercel dev` → `http://localhost:3000/mcp` |

Always run `npm run typecheck && npm test` before committing.

## Verified API facts

These come from Garmin's OpenAPI spec (Personal API 1.0.0) and its reference client, so you don't need to look them up again:

- Base URL: `https://personal.connectapi.garmin.com`.
- Token: `POST /personalapitoken-service/personal-api/personal-api-key/token`, header `Authorization: ApiKey <key>`, no body. The response body is the **raw JWT as text**, not JSON. Lifetime: 24h, or until the key expires if that comes first. No refresh tokens.
- Data calls: `GET` with `Authorization: Bearer <jwt>`. Errors: 400/401/403/404/500. Some endpoints return 204 when there is no data.
- Documented max ranges: steps and stress 28 days; hydration, sleep summaries and Body Battery 31 days; v2 daily summaries 1 year (enforced as 365 days, counting both ends).
- Units: distances in m, durations in s, hydration in ml, stress durations in s. **Body weights are in grams** everywhere (weigh-ins, weight summaries, weight goals). The spec says weigh-ins are kg, but live data checked in Oct 2026 is gram-scale. In weigh-in entries, `date` and `timestampGMT` are epoch ms numbers, although the spec says strings.

## Known Garmin API issues (verified live, Oct 2026)

- `GET /weight-service/weight/all/{startDate}/{endDate}` answers **400 with body `{}`** to every documented request, including single days with weigh-ins. `garmin_get_weight_entries` still tries it first, then falls back to `weight/range?includeAll=true` and flattens `dailyWeightSummaries[].allWeightMetrics`, which has the same fields. If Garmin fixes the endpoint, the fallback stops being used automatically.
- When the spec and live data disagree, trust live data. Check with `npm run smoke`, and with a throwaway script that prints only types or magnitudes, never values.
- Personal tier: read-only, pull-only, own data only, not for commercial multi-user apps. No Training API (workout upload) and no webhooks.

Where the spec lives: https://developer.garmin.com/gc-developer-program/personal/swagger-docs/. The page renders an OpenAPI 3.0.1 document that is embedded in the page's JavaScript bundle; there is no standalone JSON URL. Garmin's reference Python client is https://github.com/garmin/connect-personal-api-python.

## Stay on TypeScript 6 (Vercel can't use TypeScript 7 yet)

`typescript` is pinned to `^6`. Don't upgrade it to 7.x until Vercel's builder supports it:

- **What 7.x changed:** TypeScript 7 (the native Go compiler) no longer ships the JavaScript compiler API. In 7.0 and 7.1, `require('typescript')` exports only the version number.
- **Why Vercel needs it:** Vercel's production builder (`@vercel/backends`) loads `typescript` from this project and type-checks `api/mcp.ts` with that API (`ts.readConfigFile`, `ts.sys`, `ts.createProgram`, `ts.getPreEmitDiagnostics`). On 7.x the deploy crashes with `TypeError: Cannot read properties of undefined (reading 'readFile')`. Seen on a real deploy, Oct 2026.
- **Why local checks miss it:** a local `npx vercel build` takes a different path ("Using the TypeScript … compiler executable") and passes either way.

To check whether a new TypeScript (or Vercel) version works, first confirm `node -e "console.log(typeof require('typescript').createProgram)"` prints `function`. Then deploy a preview to Vercel.

## Adding or updating a tool

When Garmin adds or changes an endpoint:

1. Add or edit the definition in the matching `src/tools/<area>.ts` with `jsonTool({...})`. Use `customTool` only for non-JSON responses, like the file download.
   - `name`: `garmin_<verb>_<thing>`, snake_case.
   - `endpoint`: exactly `GET /path/{param}` as written in the spec. Tests compare against this.
   - `inputSchema`: a `z.object` whose fields all have `.describe()`. Reuse `date()`, `startDate()`, `endDate()`, `integer()` and `activityId` from `schemas.ts`. Keep Garmin's parameter names. Optional fields use `.optional()`, not `.nullish()`: `registerAllTools` already accepts `null` as "not set" (`nullAsMissing`), and `.nullish()` would advertise a `["string","null"]` type that some clients reject. **Never use `z.coerce`**: it turns `null`/`""`/`false` into 0 and silently changes the request.
   - `validate`: use `checkRange(start, end, maxDays)` when the spec documents a maximum span.
   - `request(args, ctx)`: build the path with `seg()` for path params. Query values that are `undefined` or `null` are dropped automatically, and arrays are repeated. Use `ctx.today()` if a default date is unavoidable.
2. If it is a new area file, add it to `allTools` in `src/tools/index.ts`.
3. Update `test/tools.test.ts`: add the endpoint to `SPEC_ENDPOINTS` and a sample to `CASES`. The tests fail until both are present. Then update the tool count (26) in the tests and the README.
4. Add the tool name to the **Tools** table in `README.md` (a test checks every tool is listed). Keep the README short: details belong in the tool description, and hosting or troubleshooting notes go in `docs/deployment.md`.

### Description style guide

Tool descriptions are the product: the model chooses tools from them. Each description should:

- Say what data comes back, naming the important response fields.
- State **units** (m, s, kg, g, ml, bpm, %, W) and the **max range**, if there is one.
- Say **when to use a sibling tool instead**, e.g. single day vs range, or summary vs raw file.
- Mention when data depends on device support or user logging (HRV, SpO2, nutrition, hydration, cycle tracking).
- Stay factual. Copy wording from the spec rather than guessing; if unsure, check the spec schema.

## Conventions

- **Read-only only.** Every tool has `readOnlyHint: true` and `destructiveHint: false`. Never add write endpoints.
- **Never log or return secrets.** That covers `GARMIN_API_KEY`, `MCP_AUTH_TOKEN` and access tokens. Use stderr for diagnostics in stdio mode, because stdout carries the protocol.
- **Tools never throw.** `runTool` turns validation and API failures into `isError: true` results with actionable text.
- **OAuth stays stateless and single-user.** It is enabled only when `MCP_OAUTH_CLIENT_ID` and `MCP_OAUTH_CLIENT_SECRET` are both set; one without the other is a 500. The signing key is derived from `MCP_AUTH_TOKEN`, the client ID and the client secret, so rotating any of them revokes everything. Redirect URIs must be on the allowlist (`DEFAULT_REDIRECT_URIS`, loopback, `MCP_OAUTH_REDIRECT_URIS`), and errors about the client or redirect URI are shown on a page, never redirected. Codes live 5 minutes and can't be marked as used (there is no storage), which is why redeeming one requires the client secret, and PKCE whenever a challenge was sent. Don't add dynamic client registration or any persistent state without revisiting this design. `test/oauth.test.ts` includes an end-to-end run with the SDK's OAuth client.
- **Vercel routing for OAuth:** `vercel.json` rewrites `/oauth/*` and `/.well-known/oauth-*` to the function and passes the original path as `?__route=`, which `oauthRoute()` reads.
- **HTTP fails closed.** Don't weaken the auth gate in `src/http.ts`. A missing or short `MCP_AUTH_TOKEN` must keep returning 500.
- **Portability:** everything reachable from `src/http.ts` must stay web-standard (Fetch API, `crypto.subtle`, `atob`/`btoa`) so it runs on Vercel, Workers, Netlify and Deno. Node-only code (`node:*`, `Buffer`, `process.env`) belongs in `src/stdio.ts` or `src/local-files.ts`. `test/portability.test.ts` walks the import graph and fails otherwise.
- **Dates** are `YYYY-MM-DD` in the user's local calendar. Don't silently default dates to "today". The only exception is `todayDate` for the menstrual day view: it uses `ctx.today()`, which is the local date in stdio and UTC when hosted.
- **Timeouts:** every request to Garmin uses `GARMIN_TIMEOUT_MS` (12s). A tool call makes at most four requests, so keep 4 × timeout under `maxDuration` in `vercel.json` (60s).
- **Install scripts:** npm 12 blocks dependency install scripts unless `allowScripts` in `package.json` covers them. `esbuild` and `fsevents` are explicitly denied: esbuild's binary comes from its optional `@esbuild/<platform>` package, and tsx, vitest and tsc were verified to work without the scripts. Review any new dependency that npm reports under `install-scripts` before allowing it.
- **Node version:** `engines.node` is bounded (`>=20 <25`) so Vercel doesn't silently move to a new Node major. Raise the upper bound only after testing that version.
- **Vercel entrypoint names:** never add a file named `server.*`, `app.*`, `index.*` or `main.*` at the repo root or in `src/`. Vercel uses those names to detect a Node server project and would run that file instead of `api/mcp.ts`. `vercel.json` also pins `"framework": null`. Both are enforced by `test/portability.test.ts`.
- **Style:** TypeScript strict, ESM with `.js` import suffixes, 2-space indent, single quotes. Match the surrounding code.
- **Git:** commits in this repo use the author email `pedrokehl@hotmail.com`. It is set in the repo-local git config; don't change it. Don't add `Co-Authored-By` or any other AI attribution trailer. Keep commits small and focused, with an imperative subject line.
