// Trial-ending email (the second half of #121) — the ONE place the "your trial
// ends in a few days" message is built and sent. It is triggered by Stripe's
// `customer.subscription.trial_will_end` webhook (fired 3 days before
// `trial_end`) through app/api/billing/webhook/route.ts, and previewed via
// POST /api/account/email-preview { template: "trial_ending" }.
//
// Same two rules as lib/welcomeEmail (mirror it, don't fork it):
//   1. `trialEndingEmail()` is pure — subject/html/text from a first name, a
//      price string, the trial-end instant and the base URL — so the copy is
//      testable without the network.
//   2. `sendTrialEndingEmail()` NEVER throws: a Resend outage must never turn a
//      verified webhook into a 500 (which would delete the StripeEvent row and
//      make Stripe retry). Unlike the welcome email it IS awaited by the route:
//      the StripeEvent row is already committed, so a `void` send frozen by the
//      serverless runtime after the response would be lost for good — a charge
//      with no notice. ~2s, well inside the route's 30s budget.
//
// Honesty rules: the price is read from Stripe (`priceDisplay`, never a
// literal) and drops to a neutral phrase if Stripe is unreachable; the cutoff
// is Stripe's `trial_end` rendered as an exact moment with time + zone
// (`formatDateTimeHuman`) — a date alone is wrong for a student west of New
// York whose "October 10, 2:00 AM ET" cutoff is still the night of the 9th. A
// student who already scheduled a cancel never gets this email (nothing will
// be charged) — that decision is made in lib/stripe outcomeFromEvent.
//
// Transactional, not marketing: one message, once per trial, about a charge
// the student agreed to — so there is deliberately no unsubscribe link.

import { sendEmail } from "./email";
import { appOrigin } from "./appUrl";
import { logEvent } from "./funnel";
import { priceDisplay } from "./stripe";
import { formatDateHuman, formatDateTimeHuman } from "./calendarDates";
import { firstNameOf, type BuiltEmail } from "./welcomeEmail";

const SUPPORT_EMAIL = "support@navolearning.com";

/** What the copy says when Stripe can't tell us the price right now. Never a
 *  number: we don't print a figure we can't stand behind. */
export const TRIAL_ENDING_PRICE_FALLBACK = "your monthly plan price";

/** The price string for this email: Stripe's, or the neutral fallback. Shared
 *  by the webhook sender and the preview route so both degrade identically. */
export async function trialEndingPrice(): Promise<string> {
  const price = await priceDisplay().catch(() => null);
  return price ?? TRIAL_ENDING_PRICE_FALLBACK;
}

/** "Your Navo trial ends Monday, October 6 — here's what happens next" (the
 *  subject carries the day only; the exact cutoff is in the body). */
export function trialEndingSubject(trialEnd: Date | number): string {
  return `Your Navo trial ends ${formatDateHuman(trialEnd, { weekday: true })} — here's what happens next`;
}

/** Pure builder. `trialEnd` is the instant the trial ends (Stripe's `trial_end`
 *  as a Date / epoch ms); `price` is the Stripe string ("$4.99/month") or
 *  TRIAL_ENDING_PRICE_FALLBACK; `appUrl` is the public origin (lib/appUrl) —
 *  never a request Host. */
export function trialEndingEmail({
  firstName,
  price,
  trialEnd,
  appUrl,
}: {
  firstName: string;
  price: string;
  trialEnd: Date | number;
  appUrl: string;
}): BuiltEmail {
  const base = appUrl.replace(/\/+$/, "");
  const keepLink = `${base}/dashboard`;
  const manageLink = `${base}/account`;
  const subject = trialEndingSubject(trialEnd);
  const cutoff = formatDateTimeHuman(trialEnd);

  const text =
    `Hi ${firstName},\n\n` +
    `Your free Navo trial ends ${cutoff}. After that, ${price} is charged to the card on file each month. ` +
    `You can cancel anytime from your account, and you won't be charged.\n\n` +
    `Nothing changes on your end: your courses, your plan, and everything you've set up stay exactly where they are.\n\n` +
    `Keep going: ${keepLink}\n` +
    `Manage or cancel: ${manageLink}\n\n` +
    `If you'd rather not continue, cancel before then and nothing is charged.\n\n` +
    `Questions, or something looks wrong? Email us at ${SUPPORT_EMAIL} — a real person reads it.\n\n` +
    `— The Navo team\n\n` +
    `You're getting this because your Navo free trial is about to end. It's a one-time message about your account.`;

  // Inline styles only (email clients strip <style>), single column, plain-text-
  // shaped body — identical palette and spacing to lib/welcomeEmail.
  const wrap = "margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;";
  const card = "max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;color:#161619;font-size:16px;line-height:1.6;";
  const p = "margin:0 0 16px;color:#161619;font-size:16px;line-height:1.6;";
  const button =
    "display:inline-block;background:#7c5cf0;color:#ffffff;text-decoration:none;" +
    "font-weight:600;font-size:16px;padding:12px 24px;border-radius:8px;";
  const secondary =
    "display:inline-block;background:#ffffff;color:#6a47e0;text-decoration:none;border:1px solid #c9bdf7;" +
    "font-weight:600;font-size:16px;padding:11px 23px;border-radius:8px;margin-left:12px;";
  const foot = "margin:0;color:#6b7280;font-size:13px;line-height:1.5;";

  const html =
    `<div style="${wrap}">` +
    `<div style="${card}">` +
    `<p style="${p}">Hi ${firstName},</p>` +
    `<p style="${p}">Your free Navo trial ends <strong>${cutoff}</strong>. After that, <strong>${price}</strong> is charged to the card on file each month. You can cancel anytime from your account, and you won't be charged.</p>` +
    `<p style="${p}">Nothing changes on your end: your courses, your plan, and everything you've set up stay exactly where they are.</p>` +
    `<p style="margin:0 0 24px;"><a href="${keepLink}" style="${button}">Keep going</a><a href="${manageLink}" style="${secondary}">Manage or cancel</a></p>` +
    `<p style="${p}">If you'd rather not continue, cancel before then and nothing is charged.</p>` +
    `<p style="${p}">Questions, or something looks wrong? Email us at <a href="mailto:${SUPPORT_EMAIL}" style="color:#6a47e0;">${SUPPORT_EMAIL}</a> — a real person reads it.</p>` +
    `<p style="${p}">— The Navo team</p>` +
    `<hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0;" />` +
    `<p style="${foot}">You're getting this because your Navo free trial is about to end. It's a one-time message about your account.</p>` +
    `</div></div>`;

  return { subject, html, text };
}

/** The trial-end instant from Stripe's `trial_end` (unix seconds), falling
 *  back to the stored trialEndsAt when the event carries none; null = neither. */
export function trialEndOf(sub: { trial_end?: number | null }, fallback?: Date | null): Date | null {
  if (sub.trial_end) return new Date(sub.trial_end * 1000);
  return fallback ?? null;
}

/**
 * The trial-ending send. The route AWAITS it (see the module comment) but it
 * still swallows EVERYTHING (Stripe price read, build errors, provider errors):
 * an email failure must never fail the webhook response. `trial_ending_sent`
 * is logged only when the send reports ok, with `meta` (the route passes the
 * Stripe event id) so a funnel row can be traced back to its delivery. Sends
 * nothing without an address or a date — a wrong or blank date would be worse
 * than no email, and a trial_will_end event always carries `trial_end`.
 */
export async function sendTrialEndingEmail(
  user: { id?: number; email: string; fullName: string | null; trialEndsAt?: Date | null },
  sub: { trial_end?: number | null },
  requestOrigin = "",
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    const to = user?.email?.trim();
    if (!to) return;
    const trialEnd = trialEndOf(sub, user.trialEndsAt);
    if (!trialEnd) {
      console.error("[trial-ending-email] no trial_end on the event and no trialEndsAt on file — not sent", { userId: user.id ?? null });
      return;
    }
    const { subject, html, text } = trialEndingEmail({
      firstName: firstNameOf(user.fullName),
      price: await trialEndingPrice(),
      trialEnd,
      appUrl: appOrigin(requestOrigin),
    });
    const res = await sendEmail({ to, subject, text, html });
    if (res?.ok) await logEvent("trial_ending_sent", user.id ?? null, meta);
  } catch (err) {
    console.error("[trial-ending-email] send failed (webhook unaffected)", err);
  }
}
