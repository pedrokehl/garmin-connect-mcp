# Garmin Connect MCP

Let Claude, Cursor or any [MCP](https://modelcontextprotocol.io) client read **your own** Garmin data (activities, sleep, HRV, Body Battery, stress, steps, heart rate, weight and more) through Garmin's official [Connect Personal API](https://developer.garmin.com/gc-developer-program/personal/personal-api).

> "How did I sleep this week compared to last week?" · "Summarize my last five runs." · "Which days this month did I miss my step goal?"

It exposes all 26 Personal API endpoints as read-only tools, and you can host it yourself for free on Vercel.

> Unofficial community project, not affiliated with or endorsed by Garmin.

## Set up on Vercel

**1. Create a Garmin API key.** In Garmin Connect on the web, open [Settings → Personal API Token](https://connect.garmin.com/app/settings/personalApiToken), select **Create Key** and copy it. Garmin shows it only once.

**2. Generate a secret** to protect your endpoint. Your MCP client will send it as a bearer token:

```bash
openssl rand -base64 32
```

**3. Deploy.** Click the button and paste both values when Vercel asks:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fpedrokehl%2Fgarmin-connect-mcp&env=GARMIN_API_KEY,MCP_AUTH_TOKEN&envDescription=GARMIN_API_KEY%3A%20your%20Garmin%20Connect%20Personal%20API%20key.%20MCP_AUTH_TOKEN%3A%20a%20random%20secret%20of%2024%2B%20characters%20that%20clients%20send%20as%20a%20bearer%20token.&envLink=https%3A%2F%2Fgithub.com%2Fpedrokehl%2Fgarmin-connect-mcp%2Fblob%2Fmain%2Fdocs%2Fdeployment.md%23configuration&project-name=garmin-connect-mcp&repository-name=garmin-connect-mcp)

| Variable | Value |
|---|---|
| `GARMIN_API_KEY` | The key from step 1 |
| `MCP_AUTH_TOKEN` | The secret from step 2 |

Your server is now at `https://<your-project>.vercel.app/mcp`. Vercel's free Hobby plan is enough.

**Recommended:** the deploy button can't create [sensitive variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables), whose values can never be read back from the dashboard or CLI. To protect them, open **Settings → Environment Variables** and recreate both with **Sensitive** turned on, then redeploy. Team owners can instead turn on **Enforce Sensitive Environment Variables** under Security & Privacy *before* deploying, so new variables are sensitive from the start.

**4. Connect your MCP client.**

Claude Code:

```bash
claude mcp add --transport http garmin https://<your-project>.vercel.app/mcp --header "Authorization: Bearer <MCP_AUTH_TOKEN>"
```

Claude Desktop or Cursor, via [`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

```json
{
  "mcpServers": {
    "garmin": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<your-project>.vercel.app/mcp", "--header", "Authorization:${GARMIN_MCP_AUTH}"],
      "env": { "GARMIN_MCP_AUTH": "Bearer <MCP_AUTH_TOKEN>" }
    }
  }
}
```

claude.ai web connectors require OAuth, which this server doesn't support yet.

To run it locally instead (the most private option), or to deploy elsewhere (Cloudflare, Netlify, Deno), see [docs/deployment.md](docs/deployment.md).

## Tools

All tools are read-only. Dates are `YYYY-MM-DD` in your local calendar.

| Area | Tools |
|---|---|
| Profile | `garmin_get_user_settings` |
| Activities | `garmin_search_activities`, `garmin_get_activity`, `garmin_get_activity_workouts`, `garmin_download_activity_file` (original FIT/ZIP) |
| Daily wellness | `garmin_get_daily_summary`, `garmin_get_daily_summaries`, `garmin_get_steps`, `garmin_get_stress`, `garmin_get_hydration`, `garmin_get_wellness_activities` |
| Sleep | `garmin_get_sleep`, `garmin_get_sleep_summaries` |
| Heart & recovery | `garmin_get_heart_rate`, `garmin_get_heart_rate_zones`, `garmin_get_hrv`, `garmin_get_hrv_summaries`, `garmin_get_body_battery`, `garmin_get_spo2`, `garmin_get_fitness_age` |
| Body | `garmin_get_weight_entries`, `garmin_get_weight_summary`, `garmin_get_weight_goals` |
| Nutrition | `garmin_get_nutrition_log` |
| Women's health | `garmin_get_menstrual_cycle_summary`, `garmin_get_menstrual_cycle_day` |

Each tool's description tells the model what it returns, its units and its limits, so you don't need to learn them.

## Good to know

- **Your own data only, read-only.** That's the scope of Garmin's Personal API. It doesn't cover commercial or multi-user apps, and it can't upload workouts.
- **Keys expire.** You choose 30 days to 1 year when creating the key, and Garmin emails you before it expires. Create a new key, update `GARMIN_API_KEY` in Vercel, and redeploy.
- **Keep `MCP_AUTH_TOKEN` secret.** It is the only thing protecting your endpoint. If it leaks, change it in Vercel and redeploy.

## Development

```bash
npm install && npm test
```

`npm run smoke` checks every tool against the real API using `GARMIN_API_KEY` from `.env`, and prints only response shapes, never your data. Architecture and conventions are in [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE) © Pedro Kehl
