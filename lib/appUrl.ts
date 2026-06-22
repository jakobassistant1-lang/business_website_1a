// Canonical public origin for links we put in EMAILS (e.g. the password-reset
// link). This MUST come from trusted configuration, NEVER from the request's Host
// / X-Forwarded-Host header — otherwise an attacker can trigger a reset for a
// victim with a spoofed Host and have the real service email the victim a link
// pointing at the attacker's domain, capturing the valid token (CWE-640,
// "password reset poisoning"). Resolution prefers trusted sources, with the
// request origin used ONLY as a dev/localhost fallback.

let warnedUntrustedOrigin = false;

export function appOrigin(requestOrigin: string): string {
  // 1. Explicit operator override — set this in production (e.g. https://navolearning.com).
  const explicit = process.env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  // 2. The Google-login redirect URI is already trusted operator config; reuse its origin.
  const redirect = process.env.GOOGLE_AUTH_REDIRECT_URI?.trim();
  if (redirect) {
    try {
      return new URL(redirect).origin;
    } catch {
      /* malformed — fall through */
    }
  }

  // 3. Vercel sets this to the canonical production domain automatically (trusted,
  //    not attacker-controllable), so the deploy is safe-by-default without APP_URL.
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;

  // 4. No trusted source. Safe in dev (localhost); unsafe in prod — warn loudly once.
  if (process.env.NODE_ENV === "production" && !warnedUntrustedOrigin) {
    warnedUntrustedOrigin = true;
    console.error(
      "[appUrl] No trusted base URL (APP_URL / GOOGLE_AUTH_REDIRECT_URI / VERCEL_PROJECT_PRODUCTION_URL) is set — " +
        "emailed links would fall back to the request Host, which is spoofable. Set APP_URL in production.",
    );
  }
  return requestOrigin;
}
