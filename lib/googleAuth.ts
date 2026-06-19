// "Sign in with Google" — identity/login flow (OpenID Connect), SEPARATE from the
// Google *Calendar* integration in lib/googleCalendar. It uses its OWN OAuth client
// (GOOGLE_AUTH_* env) so it only ever asks for the non-sensitive basic scopes
// (openid/email/profile) and can be published to production WITHOUT Google's
// sensitive-scope verification (unlike the calendar client). Server-only — never
// expose the client secret to the browser.

import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "./prisma";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

// Basic OpenID scopes only — Google treats these as non-sensitive.
const SCOPES = ["openid", "email", "profile"];

const FETCH_TIMEOUT_MS = 10_000;

export function isGoogleAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_AUTH_CLIENT_ID &&
      process.env.GOOGLE_AUTH_CLIENT_SECRET &&
      process.env.GOOGLE_AUTH_REDIRECT_URI,
  );
}

/** Canonical public origin for our own redirects — derived from the configured
 *  redirect URI (correct behind a proxy), falling back to the request origin. */
export function googleAuthOrigin(fallback: string): string {
  const uri = process.env.GOOGLE_AUTH_REDIRECT_URI;
  if (uri) {
    try {
      return new URL(uri).origin;
    } catch {
      /* fall through */
    }
  }
  return fallback;
}

// --- CSRF state (double-submit) ----------------------------------------------
// Login has no session yet, so (unlike the calendar connect flow) the state can't
// be bound to a session. Instead: a random nonce is dropped in an httpOnly cookie
// AND carried in the `state` param under an HMAC. At callback we require the cookie
// nonce to equal the state's nonce and the signature to recompute — which blocks a
// forged or tampered callback (login CSRF).
function stateSecret(): string {
  // Reuse ENCRYPTION_KEY (already used by lib/crypto + the calendar state). The
  // fallback only applies in dev and still provides the double-submit check.
  return process.env.ENCRYPTION_KEY || "google-login-state-dev-fallback";
}

export function signLoginState(nonce: string): string {
  const sig = createHmac("sha256", stateSecret()).update(nonce).digest("hex");
  return `${nonce}.${sig}`;
}

export function verifyLoginState(state: string, cookieNonce: string): boolean {
  const dot = state.indexOf(".");
  if (dot < 0) return false;
  const nonce = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  if (!nonce || !sig || nonce !== cookieNonce) return false; // double-submit check
  const expected = createHmac("sha256", stateSecret()).update(nonce).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b); // integrity check
}

export function buildLoginAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_AUTH_CLIENT_ID ?? "",
    redirect_uri: process.env.GOOGLE_AUTH_REDIRECT_URI ?? "",
    response_type: "code",
    scope: SCOPES.join(" "),
    prompt: "select_account", // let the user choose which Google account
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function fetchWithTimeout(input: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Exchange the authorization code for an access token (login client). */
export async function exchangeLoginCode(code: string): Promise<string> {
  const res = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_AUTH_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_AUTH_CLIENT_SECRET ?? "",
      redirect_uri: process.env.GOOGLE_AUTH_REDIRECT_URI ?? "",
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`google_login_token_exchange_failed_${res.status}`);
  const json = await res.json().catch(() => ({}));
  const accessToken = String(json.access_token ?? "");
  if (!accessToken) throw new Error("google_login_no_access_token");
  return accessToken;
}

export type GoogleProfile = { sub: string; email: string; emailVerified: boolean; name: string };

/** Fetch the signed-in Google user's basic profile. Returns null on any failure. */
export async function fetchGoogleProfile(accessToken: string): Promise<GoogleProfile | null> {
  try {
    const res = await fetchWithTimeout(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    const json = await res.json().catch(() => ({}));
    if (typeof json.email !== "string" || !json.email) return null;
    return {
      sub: String(json.sub ?? ""),
      email: json.email,
      emailVerified: json.email_verified === true || json.email_verified === "true",
      name: typeof json.name === "string" ? json.name : "",
    };
  } catch {
    return null;
  }
}

/**
 * Find the account for a verified Google profile, creating one if needed.
 * Auto-links by verified email: a Google sign-in for an email that already has an
 * account (e.g. an email/password signup) logs into THAT account — no duplicate.
 * New accounts are passwordless students; admin is still decided by isAdmin / the
 * ADMIN_EMAILS allowlist (never granted here). Requires a Google-verified email.
 */
export async function findOrCreateGoogleUser(profile: GoogleProfile) {
  if (!profile.emailVerified) throw new Error("google_email_unverified");
  const email = profile.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  return prisma.user.create({
    data: {
      email,
      password: null, // passwordless — sign-in is via Google
      fullName: profile.name || email.split("@")[0],
      tosAcceptedAt: new Date(), // continuing through Google consent = TOS acceptance
      isAdmin: false,
      onboardedAt: null, // brand-new student → show the first-run demo
    },
  });
}
