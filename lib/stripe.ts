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

/** Embedded Checkout session: subscription mode, 7-day trial, completion handled
 *  in-page (no redirect — the funnel never leaves app.navolearning.com). */
export async function createTrialCheckoutSession(user: { id: number; email: string; fullName: string; stripeCustomerId: string | null }) {
  const customer = await getOrCreateCustomer(user);
  const session = await stripe().checkout.sessions.create({
    ui_mode: "embedded",
    mode: "subscription",
    customer,
    line_items: [{ price: priceId(), quantity: 1 }],
    subscription_data: { trial_period_days: 7, metadata: { userId: String(user.id) } },
    metadata: { userId: String(user.id) },
    redirect_on_completion: "never",
  });
  return { clientSecret: session.client_secret!, sessionId: session.id };
}

// ---- pure helpers (unit-tested) ----

/** Does this checkout session belong to this user? Confirm must refuse foreign
 *  session ids — a session id is not a capability. */
export function sessionBelongsTo(session: { metadata?: Record<string, string> | null }, userId: number): boolean {
  return session.metadata?.userId === String(userId);
}

/** Map a completed session (+expanded subscription) to our User billing fields.
 *  Returns null unless the session is genuinely complete with a subscription. */
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
  return {
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    subscriptionStatus: sub.status === "active" ? "active" : "trialing",
    trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
  };
}
