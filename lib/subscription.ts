// The ONE vocabulary for billing status (#117, single-source rule): every access
// decision, redirect, and display reads these helpers — never a raw string
// comparison scattered in a page. The card itself lives only at Stripe; we hold
// two pointer ids + this one status word (User.subscriptionStatus).
//
// Lifecycle: signup → "none" → (demo → /welcome/card → Stripe checkout) →
// "trialing" → day-7 charge → "active"; failures/cancels → "past_due"/"canceled".
// "grandfathered" = accounts created before billing existed (backfilled) — full
// access forever, never shown a card screen.

export const SUBSCRIPTION_STATUSES = ["grandfathered", "none", "trialing", "active", "past_due", "canceled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Coerce a stored string to a known status; unknown values fail CLOSED to
 *  "none" (worst case: a paying user re-sees the card page, which reconciles
 *  with Stripe and lets them through — never silent free access). */
export function asStatus(s: string | null | undefined): SubscriptionStatus {
  return (SUBSCRIPTION_STATUSES as readonly string[]).includes(s ?? "") ? (s as SubscriptionStatus) : "none";
}

/** May this account use the app? Enforced per request (#119) via accessDecision —
 *  never from session existence (sessions don't expire server-side). */
export function hasAppAccess(status: string | null | undefined): boolean {
  const s = asStatus(status);
  return s === "grandfathered" || s === "trialing" || s === "active";
}

/** Should this account be routed to the card step (after the demo)? "none" has
 *  never paid; "canceled" restarts by paying again (#119) — both go to the card. */
export function needsCheckout(status: string | null | undefined): boolean {
  const s = asStatus(status);
  return s === "none" || s === "canceled";
}

/** Statuses that have a live Stripe subscription behind them — the ones the
 *  Billing Portal can act on (cancel, keep, update the card). grandfathered and
 *  none have no subscription; canceled restarts through the card step instead. */
export function canManageBilling(status: string | null | undefined): boolean {
  const s = asStatus(status);
  return s === "trialing" || s === "active" || s === "past_due";
}

/** What the /account billing card shows (#109), decided here so the component
 *  holds no status comparisons. "hidden" = flag off (prod inert) or a status
 *  that never reaches /account at all: requirePageAccess redirects none to the
 *  card step and past_due / canceled to their own screens before the page
 *  renders, so only the allowed statuses (and admins) get a card. */
export type BillingCardState = "hidden" | "grandfathered" | "trialing" | "active" | "cancel_scheduled";
export function billingCardState(
  user: { subscriptionStatus: string | null | undefined; cancelAtPeriodEnd?: boolean | null },
  enabled: boolean,
  isAdmin: boolean,
): BillingCardState {
  if (!enabled) return "hidden";
  const s = asStatus(user.subscriptionStatus);
  if (isAdmin || s === "grandfathered") return "grandfathered";
  if (s === "active") return user.cancelAtPeriodEnd ? "cancel_scheduled" : "active";
  if (s === "trialing") return user.cancelAtPeriodEnd ? "cancel_scheduled" : "trialing";
  return "hidden";
}

/** Master switch: billing flows activate only when BILLING_ENABLED is set on the
 *  environment. Keeps prod inert until live Stripe keys exist (ticket #49). */
export function billingEnabled(): boolean {
  return isBillingFlagOn(process.env.BILLING_ENABLED);
}

/** The one parse of the BILLING_ENABLED value ("1"/"true" → on). Pure, so the
 *  admin billing-health report reads the flag by the same rule. */
export function isBillingFlagOn(value: string | undefined): boolean {
  const v = (value ?? "").toLowerCase();
  return v === "1" || v === "true";
}

/** Where the demo's End/Skip should send the student (#118 flow:
 *  signup → demo → card → app). Pure, so the flow rule is unit-tested. */
export function postDemoDestination(status: string | null | undefined, enabled: boolean, isAdmin: boolean): string {
  if (enabled && !isAdmin && needsCheckout(status)) return "/welcome/card";
  return "/dashboard?welcome=1";
}

// ---- per-request access gating (#119) ----

/** Where a request may go. "allow" = into the app; every other value maps to
 *  exactly one destination in DECISION_PATH. */
export type AccessDecision = "allow" | "demo" | "checkout" | "past_due" | "canceled";

/** THE access rule, pure and unit-tested. Every layout/route reads this — no
 *  page or handler does its own status comparison. Order matters:
 *  flag off → allow (prod is byte-for-byte unchanged while BILLING_ENABLED is
 *  unset); admins → allow; grandfathered/trialing/active → allow; past_due and
 *  canceled → their screens; otherwise (none or unknown, via asStatus) the
 *  student is mid-funnel: demo first, then the card step. */
export function accessDecision(
  user: { subscriptionStatus: string | null | undefined; onboardedAt: Date | string | null | undefined },
  enabled: boolean,
  isAdmin: boolean,
): AccessDecision {
  if (!enabled) return "allow";
  if (isAdmin) return "allow";
  const s = asStatus(user.subscriptionStatus);
  if (hasAppAccess(s)) return "allow";
  if (s === "past_due") return "past_due";
  if (s === "canceled") return "canceled";
  return user.onboardedAt ? "checkout" : "demo";
}

/** The one place a non-allow decision becomes a URL. */
export const DECISION_PATH: Record<Exclude<AccessDecision, "allow">, string> = {
  demo: "/demo",
  checkout: "/welcome/card",
  past_due: "/billing/past-due",
  canceled: "/billing/canceled",
};

// ---- trial length + trial copy (#110) ----

/** The free-trial length in days — the ONE number (single-source rule). Stripe is
 *  given it via lib/stripe.trialDaysFor, and every piece of trial copy reads it
 *  from here, so the promise and the charge can never drift. */
export const TRIAL_DAYS = 7;

/** Is this account inside its free trial? The one place the "trialing" word is
 *  compared, so no page or component does its own raw status check (#119 rule). */
export function isTrialing(status: string | null | undefined): boolean {
  return asStatus(status) === "trialing";
}

/** Whole days left in a trial, rounded UP (6.9 days reads "7 days"; a half day
 *  reads "1"), clamped at 0 once the end has passed. null when there is no end
 *  date or it isn't a usable date — the caller then shows nothing rather than a
 *  made-up number. Pure, so the banner's math is unit-tested. */
export function trialDaysLeft(trialEndsAt: Date | string | null | undefined, now: Date): number | null {
  if (!trialEndsAt) return null;
  const end = trialEndsAt instanceof Date ? trialEndsAt : new Date(trialEndsAt);
  const ms = end.getTime();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.ceil((ms - now.getTime()) / 86_400_000));
}

/** What the student is agreeing to at signup (#110), computed on the server so
 *  the client never holds a price. Lives here (not in the client component) so
 *  lib never has to import from a "use client" module. null (the whole object)
 *  = billing is off → no money copy renders at all; a null `price` = Stripe was
 *  unreachable → the copy drops the number instead of guessing one. */
export type TrialTerms = { price: string | null; trialDays: number };

/** THE trial-banner sentence (everything before the "Manage in Account" link).
 *  Pure, so every branch is unit-tested instead of read off a screenshot.
 *
 *  null = render nothing: the trial is over (day 0 — webhook lag; the status
 *  flip is what should move them, not a "0 days left" banner).
 *
 *  A student who has already scheduled a cancel must NOT be told about a future
 *  charge — their plan simply ends, so the "then {price}" clause is dropped.
 *  Without a price (Stripe unreachable) the clause is dropped too: we never
 *  print a number we can't stand behind. */
export function trialBannerText({
  daysLeft,
  price,
  cancelAtPeriodEnd,
}: {
  daysLeft: number | null;
  price: string | null;
  cancelAtPeriodEnd?: boolean | null;
}): string | null {
  if (daysLeft === null || daysLeft <= 0) return null;
  const lead = daysLeft <= 1 ? "Last day of your free trial" : `${daysLeft} days left in your free trial`;
  if (cancelAtPeriodEnd) return `${lead} — your plan ends then and you won’t be charged.`;
  return price ? `${lead} — then ${price}.` : `${lead}.`;
}
