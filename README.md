# Garmin Connect MCP

Let Claude, Gemini, ChatGPT or any other [MCP](https://modelcontextprotocol.io) client read **your own** Garmin data (activities, sleep, HRV, Body Battery, stress, steps, heart rate, weight and more) through Garmin's official [Connect Personal API](https://developer.garmin.com/gc-developer-program/personal/personal-api).

> "How did I sleep this week compared to last week?" · "Summarize my last five runs." · "Which days this month did I miss my step goal?"

It exposes all 26 Personal API endpoints as read-only tools, and you can host it yourself for free on Vercel.

> Unofficial community project, not affiliated with or endorsed by Garmin.

## Set up on Vercel

**1. Create a Garmin API key.** In Garmin Connect on the web, open [Settings → Personal API Token](https://connect.garmin.com/app/settings/personalApiToken), select **Create Key** and copy it. Garmin shows it only once.

**2. Generate two secrets**: a client secret for the app to store, and a sign-in password that only you type. Run this twice:

```bash
openssl rand -base64 32
```

**3. Deploy** and fill in the variables when Vercel asks:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fpedrokehl%2Fgarmin-connect-mcp&env=GARMIN_API_KEY,MCP_OAUTH_CLIENT_SECRET,MCP_AUTH_TOKEN,MCP_OAUTH_CLIENT_ID&envDefaults=%7B%22MCP_OAUTH_CLIENT_ID%22%3A%22garmin-mcp%22%7D&envDescription=GARMIN_API_KEY%3A%20your%20Garmin%20Personal%20API%20key.%20MCP_OAUTH_CLIENT_SECRET%20and%20MCP_AUTH_TOKEN%3A%20two%20different%20random%20secrets%20of%2024%2B%20characters.%20MCP_OAUTH_CLIENT_ID%3A%20keep%20garmin-mcp.&envLink=https%3A%2F%2Fgithub.com%2Fpedrokehl%2Fgarmin-connect-mcp%23environment-variables&project-name=garmin-connect-mcp&repository-name=garmin-connect-mcp)

### Environment variables

| Variable | Value | What it's for |
|---|---|---|
| `GARMIN_API_KEY` | The key from step 1 | Reads your Garmin data. Required. |
| `MCP_OAUTH_CLIENT_SECRET` | First secret from step 2 | The **client secret** you enter in Claude, Gemini or ChatGPT. |
| `MCP_AUTH_TOKEN` | Second secret from step 2 | Your **sign-in password**, typed on your server's sign-in page when you connect an app (step 5). Also lets header-based clients like Claude Code connect directly. |
| `MCP_OAUTH_CLIENT_ID` | `garmin-mcp` (pre-filled) | The **client ID** you enter in the app. Keep the default. |
| `MCP_OAUTH_REDIRECT_URIS` | Optional, add later if needed | Extra allowed sign-in callback URLs, comma-separated. Claude's, Gemini's and ChatGPT's are already allowed. |

`MCP_OAUTH_CLIENT_SECRET` and `MCP_AUTH_TOKEN` are each optional, but at least one must be set. Without `MCP_AUTH_TOKEN`, the sign-in page asks for the client secret instead.

Your server is now at `https://<your-project>.vercel.app/mcp`. Vercel's free Hobby plan is enough. Recommended: under **Settings → Environment Variables**, recreate the two secrets as [Sensitive](https://vercel.com/docs/environment-variables/sensitive-environment-variables) (their values can't be read back afterwards), then redeploy. The deploy button can't do this for you.

**4. Add a custom connector** in your app with:

| Field | Value |
|---|---|
| Server URL | `https://<your-project>.vercel.app/mcp` |
| Client ID | `garmin-mcp` |
| Client secret | Your `MCP_OAUTH_CLIENT_SECRET` |

- **Claude** (claude.ai and Claude Desktop): Settings → Connectors → Add custom connector. The client ID and secret go under Advanced settings.
- **Gemini**: add a custom MCP connector and fill in Client ID and Client secret. If it also asks for URLs, use `https://<your-project>.vercel.app/oauth/authorize` (authorization), `https://<your-project>.vercel.app/oauth/token` (token) and scope `garmin:read`.
- **ChatGPT**: create a connector in developer mode (on plans that offer custom connectors), choose OAuth with a user-defined OAuth client, and leave the registration URL empty.

**5. Sign in.** When you connect, Claude, Gemini or ChatGPT opens a sign-in page from your own server that asks for **`MCP_AUTH_TOKEN`**. Paste it and select **Allow access**. You only do this once per connection.

This is expected. The client ID and secret identify the app; the sign-in page proves the person connecting is you, so a leaked client secret alone isn't enough to read your data. If the page says a redirect URL isn't allowed, add that URL to `MCP_OAUTH_REDIRECT_URIS` and redeploy.

**Claude Code** connects with the token directly:

```bash
claude mcp add --transport http garmin https://<your-project>.vercel.app/mcp --header "Authorization: Bearer <MCP_AUTH_TOKEN>"
```

Other clients, running locally, and other hosts: see [docs/deployment.md](docs/deployment.md).

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
