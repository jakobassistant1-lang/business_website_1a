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
