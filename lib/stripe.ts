// Stripe integration (#118): Embedded Checkout, card upfront, 7-day trial.
// The card never touches our servers — Stripe's iframe collects it; we store two
// pointer ids + a status word (lib/subscription). Everything here is lazy: the
// module imports safely with no keys (billing is flag-gated by BILLING_ENABLED),
// and only throws if a billing call is actually attempted without configuration.
import Stripe from "stripe";
import { prisma } from "./prisma";
import { isBillingFlagOn } from "./subscription";

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
  priceDisplayCache = formatPrice(p);
  return priceDisplayCache;
}

/** The ONE price-string formatter ("$4.99/month"), shared by priceDisplay and the
 *  admin billing-health report so the two can never drift. Pure. */
export function formatPrice(p: { unit_amount: number | null; currency?: string | null; recurring?: { interval: string } | null }): string {
  const amount = (p.unit_amount ?? 0) / 100;
  const currency = (p.currency ?? "usd").toUpperCase();
  const symbol = currency === "USD" ? "$" : `${currency} `;
  const interval = p.recurring?.interval ?? "month";
  return `${symbol}${amount.toFixed(2)}/${interval}`;
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

// ---- admin billing-health (read-only Stripe setup verification) ----------
// Pure helpers behind GET /api/admin/billing-health. They take already-fetched
// Stripe shapes and return pass/fail rows that are safe to screenshot: no key
// material, no customer/price/account/config ids ever appear in a detail.

export type HealthCheck = { name: string; ok: boolean; detail: string };

export type KeyMode = "live" | "test" | "missing" | "unknown";

/** Mode of a Stripe secret key by prefix (also accepts restricted `rk_` keys). */
export function keyMode(secretKey: string | undefined): KeyMode {
  const k = (secretKey ?? "").trim();
  if (!k) return "missing";
  if (/^(sk|rk)_live_/.test(k)) return "live";
  if (/^(sk|rk)_test_/.test(k)) return "test";
  return "unknown";
}

/** Mode of a publishable key by prefix (`pk_live_` / `pk_test_`). */
export function publishableMode(pk: string | undefined): KeyMode {
  const k = (pk ?? "").trim();
  if (!k) return "missing";
  if (k.startsWith("pk_live_")) return "live";
  if (k.startsWith("pk_test_")) return "test";
  return "unknown";
}

/** The subscription price must be active, monthly (interval "month" × 1), priced
 *  above zero, and in the same mode as the keys. Detail like "$4.99/month, live". */
export function priceCheck(
  p: {
    active: boolean;
    currency: string;
    unit_amount: number | null;
    recurring?: { interval: string; interval_count?: number } | null;
    livemode?: boolean;
  } | null,
  expectedMode: "live" | "test",
): HealthCheck {
  const name = "Price";
  if (!p) return { name, ok: false, detail: "unavailable" };
  const monthly = p.recurring?.interval === "month" && (p.recurring.interval_count ?? 1) === 1;
  const priced = (p.unit_amount ?? 0) > 0;
  const mode: "live" | "test" = p.livemode ? "live" : "test";
  const problems: string[] = [];
  if (!p.active) problems.push("inactive");
  if (!p.recurring) problems.push("not recurring");
  else if (!monthly) problems.push("not monthly");
  if (!priced) problems.push("no amount");
  if (mode !== expectedMode) problems.push(`mode mismatch (keys are ${expectedMode})`);
  const detail = [formatPrice(p), mode, ...problems].join(", ");
  return { name, ok: problems.length === 0, detail };
}

/** The platform account itself: can it take money, can it be paid out, and is the
 *  card-statement descriptor set (the descriptor is public on receipts — not a secret). */
export function accountCheck(
  a: {
    charges_enabled?: boolean;
    payouts_enabled?: boolean;
    details_submitted?: boolean;
    settings?: { payments?: { statement_descriptor?: string | null } | null } | null;
  } | null,
): HealthCheck[] {
  if (!a) {
    return ["Charges enabled", "Payouts enabled", "Statement descriptor"].map((name) => ({ name, ok: false, detail: "unavailable" }));
  }
  const submitted = a.details_submitted === false ? " (account details not submitted)" : "";
  const descriptor = (a.settings?.payments?.statement_descriptor ?? "").trim();
  return [
    { name: "Charges enabled", ok: a.charges_enabled === true, detail: (a.charges_enabled ? "yes" : "no") + submitted },
    { name: "Payouts enabled", ok: a.payouts_enabled === true, detail: (a.payouts_enabled ? "yes" : "no") + submitted },
    { name: "Statement descriptor", ok: descriptor.length > 0, detail: descriptor ? `"${descriptor}"` : "not set" },
  ];
}

/** The Billing Portal (#119 past-due "update card") needs at least one active
 *  configuration that lets a customer update their payment method. */
export function portalCheck(
  configs:
    | {
        active: boolean;
        is_default?: boolean;
        features?: { subscription_cancel?: { enabled?: boolean }; payment_method_update?: { enabled?: boolean } };
      }[]
    | null,
): HealthCheck {
  const name = "Billing portal";
  if (!configs) return { name, ok: false, detail: "unavailable" };
  const active = configs.filter((c) => c.active);
  if (active.length === 0) return { name, ok: false, detail: "no active configuration" };
  const usable = active.filter((c) => c.features?.payment_method_update?.enabled === true);
  if (usable.length === 0) return { name, ok: false, detail: `${active.length} active, none allow payment-method update` };
  const cancel = usable.some((c) => c.features?.subscription_cancel?.enabled === true);
  const dflt = usable.some((c) => c.is_default) ? "default config" : "non-default config";
  return { name, ok: true, detail: `payment-method update enabled (${dflt}); cancel ${cancel ? "enabled" : "disabled"}` };
}

/** Payment Method Domain for the Embedded Checkout host: the domain must be
 *  enabled with Apple Pay verified ("active"); Google Pay and Link status are
 *  reported for context. (The legacy applePayDomains endpoint does not govern
 *  Embedded Checkout — this one does.) */
export type PaymentMethodDomainShape = {
  domain_name: string;
  enabled: boolean;
  apple_pay?: { status: string };
  google_pay?: { status: string };
  link?: { status: string };
};
export function walletDomainCheck(domains: PaymentMethodDomainShape[] | null, expectedHost: string): HealthCheck {
  const name = "Wallet domain";
  const host = expectedHost.toLowerCase();
  if (!domains) return { name, ok: false, detail: "unavailable" };
  const hit = domains.find((d) => d.enabled && d.domain_name.toLowerCase() === host);
  if (!hit) return { name, ok: false, detail: `${host}: no enabled payment method domain` };
  const status = (w?: { status: string }) => w?.status ?? "unknown";
  const detail = `${host}: Apple Pay ${status(hit.apple_pay)}, Google Pay ${status(hit.google_pay)}, Link ${status(hit.link)}`;
  return { name, ok: status(hit.apple_pay) === "active", detail };
}

/** Hostname the wallet domain must match: APP_URL's host, else the production app host. */
export const DEFAULT_APP_HOST = "app.navolearning.com";
export function expectedWalletHost(appUrl: string | undefined): string {
  const raw = (appUrl ?? "").trim();
  if (!raw) return DEFAULT_APP_HOST;
  try {
    return new URL(raw).hostname.toLowerCase() || DEFAULT_APP_HOST;
  } catch {
    return DEFAULT_APP_HOST;
  }
}

/** Env vars the money path needs. Presence only — values are never surfaced. */
export const REQUIRED_BILLING_ENV = ["STRIPE_SECRET_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "STRIPE_PRICE_ID", "APP_URL"] as const;
export const WEBHOOK_SECRET_CHECK = "STRIPE_WEBHOOK_SECRET";
export const BILLING_FLAG_CHECK = "BILLING_ENABLED";
/** Checks that never count toward allOk: the webhook secret is expected missing
 *  until #109 ships, and the master switch being OFF is a state, not a failure. */
export const INFORMATIONAL_CHECKS: ReadonlySet<string> = new Set([WEBHOOK_SECRET_CHECK, BILLING_FLAG_CHECK]);

export function envPresence(env: Record<string, string | undefined>): HealthCheck[] {
  const present = (k: string) => (env[k] ?? "").trim().length > 0;
  const rows: HealthCheck[] = REQUIRED_BILLING_ENV.map((k) => ({ name: k, ok: present(k), detail: present(k) ? "present" : "missing" }));
  rows.push({
    name: WEBHOOK_SECRET_CHECK,
    ok: present(WEBHOOK_SECRET_CHECK),
    detail: present(WEBHOOK_SECRET_CHECK) ? "present" : "missing (expected until #109 webhooks)",
  });
  const flag = env[BILLING_FLAG_CHECK];
  const on = isBillingFlagOn(flag);
  rows.push({
    name: BILLING_FLAG_CHECK,
    ok: true,
    detail: on ? "ON" : (flag ?? "").trim() ? "OFF (set, but not a true value)" : "OFF (unset)",
  });
  return rows;
}

/** Secret, publishable, and (when known) price must all be the same mode. */
export function modesAgreeCheck(secret: KeyMode, publishable: KeyMode, priceLivemode?: boolean): HealthCheck {
  const name = "Modes agree";
  const price = priceLivemode === undefined ? null : priceLivemode ? "live" : "test";
  const detail = `secret ${secret}, publishable ${publishable}${price ? `, price ${price}` : ""}`;
  const known = (secret === "live" || secret === "test") && secret === publishable;
  const ok = known && (price === null || price === secret);
  return { name, ok, detail };
}

/** allOk = every non-informational check passed. */
export function overallOk(checks: HealthCheck[]): boolean {
  return checks.filter((c) => !INFORMATIONAL_CHECKS.has(c.name)).every((c) => c.ok);
}

/** Stripe error messages can embed object ids ("No such price: 'price_…'").
 *  Strip every Stripe-style id before a message reaches the report. */
export function redactStripeIds(message: string): string {
  return message.replace(/\b(?:sk|rk|pk|whsec|price|prod|acct|cus|sub|cs|pi|seti|pm|pmd|pmc|apwc|bpc|req|in|evt|ch|src|tok|card|ba)_[A-Za-z0-9*_]+/g, "[redacted]");
}
