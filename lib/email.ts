// Minimal transactional-email sender. Talks to Resend's REST API directly via
// fetch (no SDK → no new dependency, matching the thin-fetch style of
// lib/googleAuth). Server-only — never import this into client code.
//
// Safe fallback (mirrors lib/crypto.ts): with no RESEND_API_KEY / EMAIL_FROM set,
// it does NOT send — it logs the message (including any link) to the server
// console and returns ok. So the whole forgot-password flow is testable locally
// with zero email setup; just copy the reset URL from the dev server console.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

let warnedNoProvider = false;

export async function sendEmail(msg: EmailMessage): Promise<{ ok: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    if (process.env.NODE_ENV === "production" && !warnedNoProvider) {
      warnedNoProvider = true;
      // Loud, once: in production this means emails silently aren't going out.
      console.error("[email] RESEND_API_KEY/EMAIL_FROM not set — emails are NOT being sent. Set them in production.");
    }
    console.log(`[email] not sent (no provider configured) → to=${msg.to} subject="${msg.subject}"\n${msg.text}`);
    return { ok: true };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        ...(msg.html ? { html: msg.html } : {}),
      }),
    });
    if (!res.ok) {
      console.error(`[email] Resend send failed (${res.status})`);
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    console.error("[email] Resend send threw", err);
    return { ok: false };
  }
}
