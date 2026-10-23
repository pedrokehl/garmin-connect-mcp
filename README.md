# Garmin Connect MCP

Let Claude, Cursor or any [MCP](https://modelcontextprotocol.io) client read **your own** Garmin data (activities, sleep, HRV, Body Battery, stress, steps, heart rate, weight and more) through Garmin's official [Connect Personal API](https://developer.garmin.com/gc-developer-program/personal/personal-api).

> "How did I sleep this week compared to last week?" · "Summarize my last five runs." · "Which days this month did I miss my step goal?"

It exposes all 26 Personal API endpoints as read-only tools, and you can host it yourself for free on Vercel.

> Unofficial community project, not affiliated with or endorsed by Garmin.

## Set up on Vercel

**1. Create a Garmin API key.** In Garmin Connect on the web, open [Settings → Personal API Token](https://connect.garmin.com/app/settings/personalApiToken), select **Create Key** and copy it. Garmin shows it only once.

**2. Generate a secret** to protect your server:

```bash
openssl rand -base64 32
```

**3. Deploy** with the button for the app you use, and paste the key and the secret when Vercel asks:

| You use | Deploy | The secret goes in |
|---|---|---|
| Gemini, claude.ai / Claude Desktop, or ChatGPT | [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fpedrokehl%2Fgarmin-connect-mcp&env=GARMIN_API_KEY,MCP_OAUTH_CLIENT_SECRET&envDescription=GARMIN_API_KEY%3A%20your%20Garmin%20Connect%20Personal%20API%20key.%20MCP_OAUTH_CLIENT_SECRET%3A%20a%20random%20secret%20of%2024%2B%20characters%3B%20enter%20it%20in%20the%20Gemini%20app%20or%20claude.ai%20together%20with%20the%20client%20ID%20garmin-mcp.&envLink=https%3A%2F%2Fgithub.com%2Fpedrokehl%2Fgarmin-connect-mcp%2Fblob%2Fmain%2Fdocs%2Fdeployment.md%23configuration&project-name=garmin-connect-mcp&repository-name=garmin-connect-mcp) | `MCP_OAUTH_CLIENT_SECRET` |
| Claude Code, Cursor, VS Code, Gemini CLI, or another client that can send headers | [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fpedrokehl%2Fgarmin-connect-mcp&env=GARMIN_API_KEY,MCP_AUTH_TOKEN&envDescription=GARMIN_API_KEY%3A%20your%20Garmin%20Connect%20Personal%20API%20key.%20MCP_AUTH_TOKEN%3A%20a%20random%20secret%20of%2024%2B%20characters%20that%20clients%20send%20as%20a%20bearer%20token.&envLink=https%3A%2F%2Fgithub.com%2Fpedrokehl%2Fgarmin-connect-mcp%2Fblob%2Fmain%2Fdocs%2Fdeployment.md%23configuration&project-name=garmin-connect-mcp&repository-name=garmin-connect-mcp) | `MCP_AUTH_TOKEN` |

Your server is now at `https://<your-project>.vercel.app/mcp`. Vercel's free Hobby plan is enough. You can use both kinds of client: add the other variable later under **Settings → Environment Variables** and redeploy.

**Recommended:** the deploy button can't create [sensitive variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables), whose values can never be read back from the dashboard or CLI. To protect them, recreate them under **Settings → Environment Variables** with **Sensitive** turned on, then redeploy. Team owners can instead turn on **Enforce Sensitive Environment Variables** under Security & Privacy *before* deploying.

**4. Connect your app** to `https://<your-project>.vercel.app/mcp`:

| App | Signs in with | Needs |
|---|---|---|
| Gemini app | OAuth | `MCP_OAUTH_CLIENT_SECRET` |
| claude.ai and Claude Desktop | OAuth | `MCP_OAUTH_CLIENT_SECRET` |
| ChatGPT | OAuth | `MCP_OAUTH_CLIENT_SECRET` |
| Claude Code, Cursor, VS Code, Gemini CLI | Bearer header | `MCP_AUTH_TOKEN` |

### Gemini, Claude and ChatGPT (OAuth)

1. Add a custom connector (MCP server) with the server URL, client ID `garmin-mcp`, and your `MCP_OAUTH_CLIENT_SECRET` as the client secret:
   - **Gemini:** fill in Client ID and Client secret. If it also asks for URLs, use `https://<your-project>.vercel.app/oauth/authorize` (authorization) and `https://<your-project>.vercel.app/oauth/token` (token), with scope `garmin:read`.
   - **claude.ai and Claude Desktop:** Settings → Connectors → Add custom connector. The client ID and secret go under Advanced settings.
   - **ChatGPT:** create a connector in developer mode (on plans that offer custom connectors), choose OAuth, and enter the client ID and secret as a user-defined OAuth client. Leave the registration URL empty.
2. A sign-in page from your own server opens. Paste the same client secret (or `MCP_AUTH_TOKEN`, if you set both) and select **Allow access**.

Gemini's, Claude's and ChatGPT's callback URLs are allowed by default. If the sign-in page says a redirect URL isn't allowed (for example, another app), add the URL it shows to an `MCP_OAUTH_REDIRECT_URIS` variable in Vercel and redeploy. Apps that can only register themselves automatically (dynamic client registration) and can't take a client ID and secret aren't supported; use their header option if they have one.

### Claude Code, Cursor, VS Code and Gemini CLI (bearer header)

Claude Code:

```bash
claude mcp add --transport http garmin https://<your-project>.vercel.app/mcp --header "Authorization: Bearer <MCP_AUTH_TOKEN>"
```

Cursor (`~/.cursor/mcp.json`) and Gemini CLI (`~/.gemini/settings.json`; use `httpUrl` instead of `url`):

```json
{
  "mcpServers": {
    "garmin": {
      "url": "https://<your-project>.vercel.app/mcp",
      "headers": { "Authorization": "Bearer <MCP_AUTH_TOKEN>" }
    }
  }
}
```

VS Code (`.vscode/mcp.json`):

```json
{
  "servers": {
    "garmin": {
      "type": "http",
      "url": "https://<your-project>.vercel.app/mcp",
      "headers": { "Authorization": "Bearer <MCP_AUTH_TOKEN>" }
    }
  }
}
```

Any other client that only runs local commands can connect through [`mcp-remote`](https://www.npmjs.com/package/mcp-remote): `npx -y mcp-remote https://<your-project>.vercel.app/mcp --header "Authorization: Bearer <MCP_AUTH_TOKEN>"`.

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
- **Keep your secrets secret.** `MCP_AUTH_TOKEN` and `MCP_OAUTH_CLIENT_SECRET` are what protect your data. If one leaks, change it in Vercel and redeploy. Changing either also signs out every OAuth connection.

## Development

```bash
npm install && npm test
```

`npm run smoke` checks every tool against the real API using `GARMIN_API_KEY` from `.env`, and prints only response shapes, never your data. Architecture and conventions are in [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE) © Pedro Kehl
