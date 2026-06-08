// OAuth 2.0 flow for Google (custom handler, thin fetch — matches the app's
// no-SDK convention). Server-only. Reads GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
// / GOOGLE_REDIRECT_URI from the environment; never exposes them to the client.

import type { GoogleTokens } from "./types";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

export const CALENDAR_READONLY_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
// `email`/`openid` just label the connected account. Add `calendar.events` here
// later to support write — the rest of the module is unaffected.
const SCOPES = [CALENDAR_READONLY_SCOPE, "openid", "email"];

export function isGoogleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI,
  );
}

/** The app's canonical public origin for our own redirects — derived from the
 *  configured GOOGLE_REDIRECT_URI (the same public URL Google uses) so it's
 *  correct behind a proxy, falling back to the request origin. */
export function appOrigin(fallback: string): string {
  const uri = process.env.GOOGLE_REDIRECT_URI;
  if (uri) {
    try {
      return new URL(uri).origin;
    } catch {
      /* fall through */
    }
  }
  return fallback;
}

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: process.env.GOOGLE_REDIRECT_URI ?? "",
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline", // request a refresh token
    prompt: "consent", // ensures a refresh token is returned on re-consent
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseTokens(json: any): GoogleTokens {
  return {
    accessToken: String(json.access_token ?? ""),
    refreshToken: json.refresh_token ?? null,
    expiresAt: json.expires_in ? new Date(Date.now() + Number(json.expires_in) * 1000) : null,
    scope: json.scope ?? null,
    tokenType: json.token_type,
  };
}

export async function exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: process.env.GOOGLE_REDIRECT_URI ?? "",
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`token_exchange_failed_${res.status}`);
  return parseTokens(await res.json());
}

export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`token_refresh_failed_${res.status}`);
  const tokens = parseTokens(await res.json());
  tokens.refreshToken = tokens.refreshToken ?? refreshToken; // refresh responses omit it
  return tokens;
}

/** Best-effort token revocation at Google (disconnect). Never throws. */
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: "POST" });
  } catch {
    /* ignore — local disconnect proceeds regardless */
  }
}

export async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    const json = await res.json().catch(() => ({}));
    return typeof json.email === "string" ? json.email : null;
  } catch {
    return null;
  }
}
