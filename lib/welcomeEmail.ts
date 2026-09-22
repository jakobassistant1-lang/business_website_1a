// Welcome email (#50 / the welcome half of #121) — the ONE place the new-account
// email is built and sent. Both signup doors call `sendWelcomeEmail`:
//   • password signup  → app/api/auth/signup/route.ts (after prisma.user.create)
//   • Google sign-in   → lib/googleAuth.ts findOrCreateGoogleUser (create branch only)
// Auto-link and P2002 race-loser branches return an EXISTING account, so they are
// not new signups and must not send.
//
// Two rules, both load-bearing:
//   1. `welcomeEmail()` is pure — subject/html/text from a first name + base URL —
//      so the copy is testable without touching the network.
//   2. `sendWelcomeEmail()` NEVER throws and is never awaited by a route (`void`):
//      a Resend outage, a DNS hiccup or a bad template must not cost us a signup.
//
// Transactional, not marketing: one message, sent once, about the account the
// student just created — so there is deliberately no unsubscribe link.

import { sendEmail } from "./email";
import { appOrigin } from "./appUrl";
import { logEvent } from "./funnel";

export const WELCOME_SUBJECT = "Welcome to Navo — let's get your week planned";

const SUPPORT_EMAIL = "support@navolearning.com";

/** "Ada Lovelace" → "Ada"; null / blank / whitespace → "there". */
export function firstNameOf(fullName: string | null | undefined): string {
  return (fullName ?? "").trim().split(/\s+/)[0] || "there";
}

export type BuiltEmail = { subject: string; html: string; text: string };

/** Pure builder. `appUrl` is the public origin (lib/appUrl) — never a request Host. */
export function welcomeEmail({ firstName, appUrl }: { firstName: string; appUrl: string }): BuiltEmail {
  const base = appUrl.replace(/\/+$/, "");
  const link = `${base}/`; // the root routes them to whichever step is next

  const steps: [string, string][] = [
    ["Finish the demo", "a two-minute walkthrough of how your plan works."],
    ["Connect Canvas with a token", "Navo reads your real courses and due dates."],
    ["See your plan", "your week, ordered by what actually moves your grade."],
  ];

  const text =
    `Hi ${firstName},\n\n` +
    `Welcome to Navo. Navo reads your Canvas courses and turns everything that's due ` +
    `into one plan for your week, so you always know what to work on next.\n\n` +
    `Three quick steps to get set up:\n\n` +
    steps.map(([title, detail], i) => `${i + 1}. ${title} — ${detail}`).join("\n") +
    `\n\nFinish setting up: ${link}\n\n` +
    `Stuck on anything, or something looks wrong? Email us at ${SUPPORT_EMAIL} — a real person reads it.\n\n` +
    `— The Navo team\n\n` +
    `You're getting this because you just created a Navo account. It's a one-time message about your account.`;

  // Inline styles only (email clients strip <style>), a single-column table layout,
  // and a plain-text-shaped body — same voice as the password-reset email.
  const wrap = "margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;";
  const card = "max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;color:#161619;font-size:16px;line-height:1.6;";
  const p = "margin:0 0 16px;color:#161619;font-size:16px;line-height:1.6;";
  const li = "margin:0 0 10px;color:#161619;font-size:16px;line-height:1.6;";
  const button =
    "display:inline-block;background:#7c5cf0;color:#ffffff;text-decoration:none;" +
    "font-weight:600;font-size:16px;padding:12px 24px;border-radius:8px;";
  const foot = "margin:0;color:#6b7280;font-size:13px;line-height:1.5;";

  const html =
    `<div style="${wrap}">` +
    `<div style="${card}">` +
    `<p style="${p}">Hi ${firstName},</p>` +
    `<p style="${p}">Welcome to Navo. Navo reads your Canvas courses and turns everything that's due into one plan for your week, so you always know what to work on next.</p>` +
    `<p style="${p}"><strong>Three quick steps to get set up:</strong></p>` +
    `<ol style="margin:0 0 24px;padding-left:20px;">` +
    steps.map(([title, detail]) => `<li style="${li}"><strong>${title}</strong> — ${detail}</li>`).join("") +
    `</ol>` +
    `<p style="margin:0 0 24px;"><a href="${link}" style="${button}">Finish setting up</a></p>` +
    `<p style="${p}">Stuck on anything, or something looks wrong? Email us at <a href="mailto:${SUPPORT_EMAIL}" style="color:#6a47e0;">${SUPPORT_EMAIL}</a> — a real person reads it.</p>` +
    `<p style="${p}">— The Navo team</p>` +
    `<hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />` +
    `<p style="${foot}">You're getting this because you just created a Navo account. It's a one-time message about your account.</p>` +
    `</div></div>`;

  return { subject: WELCOME_SUBJECT, html, text };
}

/**
 * Fire-and-forget welcome send. Call it with `void` — never `await` it in a route.
 * Swallows EVERYTHING (build errors, provider errors, a rejected fetch): email
 * failure must never surface to the student or fail the signup response.
 * `welcome_sent` is logged only when the send reports ok.
 */
export async function sendWelcomeEmail(
  user: { id?: number; email: string; fullName: string | null },
  requestOrigin = "",
): Promise<void> {
  try {
    const to = user?.email?.trim();
    if (!to) return; // nothing to send to — not an error worth throwing over
    const { subject, html, text } = welcomeEmail({
      firstName: firstNameOf(user.fullName),
      appUrl: appOrigin(requestOrigin),
    });
    const res = await sendEmail({ to, subject, text, html });
    if (res?.ok) await logEvent("welcome_sent", user.id ?? null);
  } catch (err) {
    console.error("[welcome-email] send failed (signup unaffected)", err);
  }
}
