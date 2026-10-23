/** Minimal, dependency-free HTML for the OAuth sign-in step. Every reflected value is escaped. */

export interface LoginPageInput {
  /** Hidden fields re-posted with the form (the authorization request). */
  params: Record<string, string>;
  clientId: string;
  redirectUri: string;
  error?: string;
}

export function loginPage(input: LoginPageInput, status = 200): Response {
  const hidden = Object.entries(input.params)
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join('\n        ');
  const redirectHost = safeHost(input.redirectUri);
  const body = `
    <h1>Connect to Garmin Connect MCP</h1>
    <p><strong>${escapeHtml(input.clientId)}</strong> is asking for read-only access to your Garmin data through this server.
       You'll be sent back to <strong>${escapeHtml(redirectHost)}</strong>.</p>
    ${input.error ? `<p class="error" role="alert">${escapeHtml(input.error)}</p>` : ''}
    <form method="post" action="/oauth/authorize">
        ${hidden}
        <label for="mcp_auth_token">Server access token (<code>MCP_AUTH_TOKEN</code>)</label>
        <input id="mcp_auth_token" name="mcp_auth_token" type="password" autocomplete="current-password" required autofocus>
        <button type="submit">Allow access</button>
    </form>
    <p class="hint">Only continue if you started this connection yourself.</p>`;
  // The form posts to this origin and is then redirected to the client: CSP form-action must allow both.
  return htmlResponse(body, status, `'self' ${safeOrigin(input.redirectUri)}`);
}

export function errorPage(title: string, message: string, status = 400): Response {
  return htmlResponse(`<h1>${escapeHtml(title)}</h1><p class="error">${escapeHtml(message)}</p>`, status, "'none'");
}

function htmlResponse(body: string, status: number, formAction: string): Response {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex">
    <title>Garmin Connect MCP</title>
    <style>
      body { font: 16px/1.5 system-ui, sans-serif; max-width: 30rem; margin: 4rem auto; padding: 0 1rem; color: #222; }
      label { display: block; margin: 1.5rem 0 0.4rem; font-weight: 600; }
      input[type=password] { width: 100%; padding: 0.6rem; font-size: 1rem; box-sizing: border-box; }
      button { margin-top: 1rem; padding: 0.6rem 1.2rem; font-size: 1rem; cursor: pointer; }
      .error { color: #b00020; }
      .hint { color: #666; font-size: 0.9rem; margin-top: 2rem; }
      code { background: #f3f3f3; padding: 0.1rem 0.3rem; border-radius: 4px; }
    </style>
  </head>
  <body>${body}
  </body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; form-action ${formAction}; frame-ancestors 'none'; base-uri 'none'`,
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
    },
  });
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeHost(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return 'an unknown address';
  }
}

function safeOrigin(uri: string): string {
  try {
    return new URL(uri).origin;
  } catch {
    return '';
  }
}
