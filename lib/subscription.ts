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

/** May this account use the app? (#119 will enforce this per-request.) */
export function hasAppAccess(status: string | null | undefined): boolean {
  const s = asStatus(status);
  return s === "grandfathered" || s === "trialing" || s === "active";
}

/** Should this account be routed to the card step (after the demo)? */
export function needsCheckout(status: string | null | undefined): boolean {
  return asStatus(status) === "none";
}

/** Master switch: billing flows activate only when BILLING_ENABLED is set on the
 *  environment. Keeps prod inert until live Stripe keys exist (ticket #49). */
export function billingEnabled(): boolean {
  const v = (process.env.BILLING_ENABLED ?? "").toLowerCase();
  return v === "1" || v === "true";
}

/** Where the demo's End/Skip should send the student (#118 flow:
 *  signup → demo → card → app). Pure, so the flow rule is unit-tested. */
export function postDemoDestination(status: string | null | undefined, enabled: boolean, isAdmin: boolean): string {
  if (enabled && !isAdmin && needsCheckout(status)) return "/welcome/card";
  return "/dashboard?welcome=1";
}
