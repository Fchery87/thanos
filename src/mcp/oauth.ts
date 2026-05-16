// src/mcp/oauth.ts
//
// PKCE OAuth 2.0 browser flow for MCP servers that use OAuth (e.g. Neon, GitHub).
//
// Flow:
//   1. Fetch /.well-known/oauth-authorization-server from the server origin
//   2. Generate a PKCE code_verifier + code_challenge
//   3. Open the authorization URL in the user's browser
//   4. Spin up a local HTTP server on a random port to catch the callback
//   5. Exchange the code for an access token
//   6. Return the token — caller stores it and reconnects
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { exec } from "node:child_process";

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier  = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

// ─── OAuth metadata ───────────────────────────────────────────────────────────

export interface OAuthServerMeta {
  authorization_endpoint: string;
  token_endpoint: string;
  /** Some servers expose a registration endpoint for dynamic clients. */
  registration_endpoint?: string;
}

/**
 * Fetch OAuth 2.0 server metadata from the standard well-known endpoint.
 * Returns null if the server doesn't expose it (not an OAuth server).
 */
export async function fetchOAuthMeta(serverUrl: string): Promise<OAuthServerMeta | null> {
  try {
    const origin    = new URL(serverUrl).origin;
    const wellKnown = `${origin}/.well-known/oauth-authorization-server`;
    const resp      = await fetch(wellKnown, { signal: AbortSignal.timeout(8_000) });
    if (!resp.ok) return null;
    const data = await resp.json() as Partial<OAuthServerMeta>;
    if (data.authorization_endpoint && data.token_endpoint) {
      return data as OAuthServerMeta;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Quick probe: does this server URL look like it needs OAuth?
 * Tries the well-known endpoint first; falls back to checking for a 401 response.
 */
export async function probeOAuth(serverUrl: string): Promise<boolean> {
  const meta = await fetchOAuthMeta(serverUrl);
  if (meta) return true;
  // Fallback: make a minimal POST and see if we get 401
  try {
    const resp = await fetch(serverUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
      signal: AbortSignal.timeout(5_000),
    });
    return resp.status === 401;
  } catch {
    return false;
  }
}

// ─── Browser open ─────────────────────────────────────────────────────────────

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"  ? `open "${url}"` :
    process.platform === "win32"   ? `start "" "${url}"` :
                                     `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) console.error("[oauth] Failed to open browser:", err.message);
  });
}

// ─── Local callback server ────────────────────────────────────────────────────

const CALLBACK_HTML_OK = `<!DOCTYPE html>
<html><head><title>Authorized</title></head>
<body style="font-family:system-ui;max-width:480px;margin:80px auto;text-align:center">
  <h2 style="color:#16a34a">&#10003; Authorization complete</h2>
  <p>You can close this tab and return to the terminal.</p>
</body></html>`;

const CALLBACK_HTML_ERR = (msg: string) => `<!DOCTYPE html>
<html><head><title>Auth Error</title></head>
<body style="font-family:system-ui;max-width:480px;margin:80px auto;text-align:center">
  <h2 style="color:#dc2626">&#10007; Authorization failed</h2>
  <p>${msg}</p>
</body></html>`;

interface CallbackResult { code: string; state: string; }

function startCallbackServer(): Promise<{ port: number; result: Promise<CallbackResult>; close(): void }> {
  return new Promise((resolveSetup, rejectSetup) => {
    let resolveResult: (r: CallbackResult) => void;
    let rejectResult:  (e: Error) => void;
    const resultPromise = new Promise<CallbackResult>((res, rej) => {
      resolveResult = res;
      rejectResult  = rej;
    });

    const server: Server = createServer((req, res) => {
      try {
        const url   = new URL(req.url ?? "/", `http://localhost`);
        const code  = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");
        const desc  = url.searchParams.get("error_description");

        if (code && state) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(CALLBACK_HTML_OK);
          server.close();
          resolveResult!({ code, state });
        } else {
          const msg = desc ?? error ?? "No authorization code received.";
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(CALLBACK_HTML_ERR(msg));
          server.close();
          rejectResult!(new Error(`OAuth callback error: ${msg}`));
        }
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal error");
        server.close();
        rejectResult!(err instanceof Error ? err : new Error(String(err)));
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolveSetup({
        port,
        result: resultPromise,
        close: () => server.close(),
      });
    });
    server.on("error", rejectSetup);
  });
}

// ─── Token exchange ───────────────────────────────────────────────────────────

async function exchangeCode(opts: {
  tokenEndpoint: string;
  code: string;
  verifier: string;
  clientId: string;
  redirectUri: string;
}): Promise<{ accessToken: string; refreshToken?: string }> {
  const body = new URLSearchParams({
    grant_type:    "authorization_code",
    code:          opts.code,
    redirect_uri:  opts.redirectUri,
    client_id:     opts.clientId,
    code_verifier: opts.verifier,
  });

  const resp = await fetch(opts.tokenEndpoint, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    body.toString(),
    signal:  AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Token exchange failed (${resp.status}): ${text || resp.statusText}`);
  }

  const data = await resp.json() as { access_token?: string; refresh_token?: string; error?: string; error_description?: string };
  if (!data.access_token) {
    throw new Error(`No access_token in response: ${data.error_description ?? data.error ?? "unknown"}`);
  }
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

// ─── Dynamic client registration (RFC 7591) ───────────────────────────────────

async function registerClient(registrationEndpoint: string, redirectUri: string): Promise<string> {
  const resp = await fetch(registrationEndpoint, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      client_name:    "pi-harness",
      redirect_uris:  [redirectUri],
      grant_types:    ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none", // public client
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Client registration failed (${resp.status}): ${text}`);
  }
  const data = await resp.json() as { client_id?: string };
  if (!data.client_id) throw new Error("No client_id returned from registration endpoint");
  return data.client_id;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export interface OAuthFlowResult {
  accessToken: string;
  refreshToken?: string;
}

/**
 * Exchange a refresh token for a new access token.
 * Call this when an HTTP MCP server returns 401 to get a new access token.
 */
export async function refreshAccessToken(opts: {
  tokenEndpoint: string;
  refreshToken: string;
  clientId: string;
}): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: opts.refreshToken,
    client_id: opts.clientId,
  });

  const resp = await fetch(opts.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Token refresh failed (${resp.status}): ${text || resp.statusText}`);
  }

  const data = await resp.json() as { access_token?: string; error?: string; error_description?: string };
  if (!data.access_token) {
    throw new Error(`No access_token in refresh response: ${data.error_description ?? data.error ?? "unknown"}`);
  }
  return data.access_token;
}

/**
 * Run a full browser-based PKCE OAuth flow for an HTTP MCP server.
 *
 * Steps:
 *   1. Fetch /.well-known/oauth-authorization-server
 *   2. Optionally register a dynamic client (if registration_endpoint present)
 *   3. Generate PKCE, open browser at authorization_endpoint
 *   4. Wait for the local callback (timeout: 5 minutes)
 *   5. Exchange code at token_endpoint
 *   6. Return the access token
 *
 * @param serverUrl - The MCP server URL (used to derive the origin for metadata)
 * @param clientId  - OAuth client ID (used when server doesn't support dynamic registration)
 */
export async function runOAuthFlow(
  serverUrl: string,
  clientId = "pi-harness",
): Promise<OAuthFlowResult> {
  const meta = await fetchOAuthMeta(serverUrl);
  if (!meta) {
    throw new Error(
      `Could not discover OAuth metadata for ${serverUrl}.\n` +
      `Tried: ${new URL(serverUrl).origin}/.well-known/oauth-authorization-server`,
    );
  }

  // Spin up local callback server first so we know the port
  const cb          = await startCallbackServer();
  const redirectUri = `http://127.0.0.1:${cb.port}/callback`;

  // Dynamic client registration if the server supports it
  let resolvedClientId = clientId;
  if (meta.registration_endpoint) {
    try {
      resolvedClientId = await registerClient(meta.registration_endpoint, redirectUri);
    } catch {
      // Fall back to the provided clientId
    }
  }

  const { verifier, challenge } = generatePKCE();
  const state = base64url(randomBytes(16));

  const authUrl = new URL(meta.authorization_endpoint);
  authUrl.searchParams.set("response_type",         "code");
  authUrl.searchParams.set("client_id",             resolvedClientId);
  authUrl.searchParams.set("redirect_uri",          redirectUri);
  authUrl.searchParams.set("state",                 state);
  authUrl.searchParams.set("code_challenge",        challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  // Request offline_access if available so we get a refresh token
  authUrl.searchParams.set("scope", "openid offline_access");

  openBrowser(authUrl.toString());

  // Wait up to 5 minutes for the user to complete the browser flow
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => {
      cb.close();
      reject(new Error("OAuth timed out waiting for browser callback (5 min)"));
    }, 5 * 60 * 1_000),
  );

  const { code } = await Promise.race([cb.result, timeout]);

  const { accessToken, refreshToken } = await exchangeCode({
    tokenEndpoint: meta.token_endpoint,
    code,
    verifier,
    clientId:     resolvedClientId,
    redirectUri,
  });

  return { accessToken, refreshToken };
}
