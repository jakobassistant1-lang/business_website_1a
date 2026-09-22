// Stripe integration (#118): Embedded Checkout, card upfront, 7-day trial.
// The card never touches our servers — Stripe's iframe collects it; we store two
// pointer ids + a status word (lib/subscription). Everything here is lazy: the
// module imports safely with no keys (billing is flag-gated by BILLING_ENABLED),
// and only throws if a billing call is actually attempted without configuration.
import Stripe from "stripe";
import { prisma } from "./prisma";

let client: Stripe | null = null;
export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set (billing should be flag-gated off)");
  if (!client) client = new Stripe(key);
  return client;
}

export function priceId(): string {
  const id = process.env.STRIPE_PRICE_ID;
  if (!id) throw new Error("STRIPE_PRICE_ID is not set");
  return id;
}

/** "$4.99/month" read from the Stripe price object — the single source for every
 *  displayed price string (never hardcoded). Cached per server instance. */
let priceDisplayCache: string | null = null;
export async function priceDisplay(): Promise<string> {
  if (priceDisplayCache) return priceDisplayCache;
  const p = await stripe().prices.retrieve(priceId());
  const amount = (p.unit_amount ?? 0) / 100;
  const currency = (p.currency ?? "usd").toUpperCase();
  const symbol = currency === "USD" ? "$" : `${currency} `;
  const interval = p.recurring?.interval ?? "month";
  priceDisplayCache = `${symbol}${amount.toFixed(2)}/${interval}`;
  return priceDisplayCache;
}

/** Idempotent: one Stripe customer per user, tagged with our userId. Safe under
 *  double-clicks — the id is persisted before checkout-session creation. */
export async function getOrCreateCustomer(user: { id: number; email: string; fullName: string; stripeCustomerId: string | null }): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripe().customers.create(
    { email: user.email, name: user.fullName, metadata: { userId: String(user.id) } },
    { idempotencyKey: `customer-create-${user.id}` },
  );
  await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

/** Embedded Checkout session: subscription mode, completion handled in-page (no
 *  redirect — the funnel never leaves app.navolearning.com). The free week is
 *  for first-timers only (trialDaysFor): a canceled student restarting pays today. */
export async function createTrialCheckoutSession(user: { id: number; email: string; fullName: string; stripeCustomerId: string | null; stripeSubscriptionId: string | null }) {
  const customer = await getOrCreateCustomer(user);
  const trialDays = trialDaysFor(user);
  const session = await stripe().checkout.sessions.create({
    ui_mode: "embedded",
    mode: "subscription",
    customer,
    line_items: [{ price: priceId(), quantity: 1 }],
    subscription_data: { ...(trialDays ? { trial_period_days: trialDays } : {}), metadata: { userId: String(user.id) } },
    metadata: { userId: String(user.id) },
    redirect_on_completion: "never",
  });
  return { clientSecret: session.client_secret!, sessionId: session.id };
}

/** Stripe Billing Portal session (#119): where a past-due student updates the
 *  card on file. Stripe hosts the page; we only hand back its URL. */
export async function createPortalSession(
  user: { id: number; email: string; fullName: string; stripeCustomerId: string | null },
  returnUrl: string,
): Promise<string> {
  const customer = await getOrCreateCustomer(user);
  const session = await stripe().billingPortal.sessions.create({ customer, return_url: returnUrl });
  return session.url;
}

// ---- pure helpers (unit-tested) ----

/** The one trial rule (#119): 7 free days only for an account that has NEVER
 *  had a subscription. Anyone with a subscription id on file (canceled, then
 *  restarting) is charged today — "restart by paying again", not another trial.
 *  Returns undefined (not 0) so the Stripe param is omitted entirely. */
export function trialDaysFor(user: { stripeSubscriptionId: string | null }): number | undefined {
  return user.stripeSubscriptionId ? undefined : 7;
}

/** The portal's return_url: the past-due screen on our trusted origin, tagged
 *  so the screen can show its "card updated? reload" hint. That screen
 *  reconciles with Stripe and redirects to / once the account is healthy. */
export function portalReturnUrl(base: string): string {
  return `${base.replace(/\/+$/, "")}/billing/past-due?from=portal`;
}

/** The past-due page's write rule: the mapped fields, or null when Stripe's
 *  state is unknown OR already what we have stored (nothing to write). Keeps
 *  the status comparison in lib, out of the page. */
export function reconcileFields(
  user: { subscriptionStatus: string | null | undefined },
  s: { status: string; trial_end?: number | null },
): ReturnType<typeof statusFromStripeSubscription> {
  const mapped = statusFromStripeSubscription(s);
  if (!mapped || mapped.subscriptionStatus === user.subscriptionStatus) return null;
  return mapped;
}

/** Map a Stripe subscription's status to our vocabulary (#119 past-due
 *  reconcile — the stand-in for webhooks #109). null = unknown state, don't
 *  write anything (incomplete, paused, …). */
export function statusFromStripeSubscription(s: {
  status: string;
  trial_end?: number | null;
}): { subscriptionStatus: "active" | "trialing" | "past_due" | "canceled"; trialEndsAt: Date | null } | null {
  const trialEndsAt = s.trial_end ? new Date(s.trial_end * 1000) : null;
  switch (s.status) {
    case "active":
      return { subscriptionStatus: "active", trialEndsAt };
    case "trialing":
      return { subscriptionStatus: "trialing", trialEndsAt };
    case "past_due":
    case "unpaid":
      return { subscriptionStatus: "past_due", trialEndsAt };
    case "canceled":
    case "incomplete_expired":
      return { subscriptionStatus: "canceled", trialEndsAt };
    default:
      return null;
  }
}

/** Does this checkout session belong to this user? Confirm must refuse foreign
 *  session ids — a session id is not a capability. */
export function sessionBelongsTo(session: { metadata?: Record<string, string> | null }, userId: number): boolean {
  return session.metadata?.userId === String(userId);
}

/** Map a completed session (+expanded subscription) to our User billing fields.
 *  Returns null unless the session is complete AND its subscription is live
 *  (trialing/active) — derived through the ONE Stripe→ours mapping below. A
 *  Checkout session stays "complete" forever, so a canceled/past_due student
 *  replaying an old session_id must get nothing written (#119 replay hole). */
export function subscriptionFieldsFromSession(session: {
  status?: string | null;
  customer?: string | { id: string } | null;
  subscription?: { id: string; status: string; trial_end?: number | null } | string | null;
}): { stripeCustomerId: string; stripeSubscriptionId: string; subscriptionStatus: "trialing" | "active"; trialEndsAt: Date | null } | null {
  if (session.status !== "complete") return null;
  const sub = session.subscription;
  if (!sub || typeof sub === "string") return null;
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (!customerId) return null;
  const mapped = statusFromStripeSubscription(sub);
  if (!mapped || (mapped.subscriptionStatus !== "trialing" && mapped.subscriptionStatus !== "active")) return null;
  return {
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    subscriptionStatus: mapped.subscriptionStatus,
    trialEndsAt: mapped.trialEndsAt,
  };
}
