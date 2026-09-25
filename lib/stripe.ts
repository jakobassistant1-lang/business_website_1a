// Stripe integration (#118): Embedded Checkout, card upfront, 7-day trial.
// The card never touches our servers — Stripe's iframe collects it; we store two
// pointer ids + a status word (lib/subscription). Everything here is lazy: the
// module imports safely with no keys (billing is flag-gated by BILLING_ENABLED),
// and only throws if a billing call is actually attempted without configuration.
import Stripe from "stripe";
import { prisma } from "./prisma";
import { isBillingFlagOn, TRIAL_DAYS, needsCheckout, isTrialing, type SubscriptionStatus } from "./subscription";
import type { FunnelEventName } from "./funnel";

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
  return user.stripeSubscriptionId ? undefined : TRIAL_DAYS;
}

/** The portal's return_url on our trusted origin, tagged `from=portal` so the
 *  landing screen can show its "changes may take a minute" hint. A past-due
 *  student returns to the past-due screen (which reconciles with Stripe and
 *  redirects to / once healthy); everyone else (#109 manage/cancel) returns to
 *  the billing card on /account. */
export function portalReturnUrl(base: string, target: "past_due" | "account" = "past_due"): string {
  const path = target === "account" ? "/account" : "/billing/past-due";
  return `${base.replace(/\/+$/, "")}${path}?from=portal`;
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

/** /account's on-return reconcile (#109), the past-due rule plus the period
 *  and cancel fields: status through reconcileFields, then currentPeriodEnd /
 *  cancelAtPeriodEnd / trialEndsAt from the same retrieved subscription. null =
 *  unknown state or nothing differs from what's stored (no write). */
export function reconcileBillingFields(
  user: { subscriptionStatus: string | null | undefined; trialEndsAt: Date | null; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean },
  s: StripeSubscriptionShape,
): { subscriptionStatus: SubscriptionStatus; trialEndsAt: Date | null; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean } | null {
  const mapped = statusFromStripeSubscription(s);
  if (!mapped) return null;
  const period = periodFields(s);
  const same = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);
  const statusChanged = reconcileFields(user, s) !== null;
  if (!statusChanged && same(user.trialEndsAt, mapped.trialEndsAt) && same(user.currentPeriodEnd, period.currentPeriodEnd) && user.cancelAtPeriodEnd === period.cancelAtPeriodEnd) {
    return null;
  }
  return { subscriptionStatus: mapped.subscriptionStatus, trialEndsAt: mapped.trialEndsAt, ...period };
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

// ---- webhooks (#109): pure event → outcome mapping ------------------------
// The route (app/api/billing/webhook) verifies the signature, records the event
// id, loads the user and (for a few event types) the subscription, then applies
// whatever these helpers return. Every Stripe status still passes through the
// ONE table, statusFromStripeSubscription — nothing here maps a status itself.

/** The subscription shape we read from events and retrievals. Stripe's basil
 *  API moved current_period_end onto the subscription items; older webhook API
 *  versions still put it on the subscription — both are read. */
export type StripeSubscriptionShape = {
  id: string;
  status: string;
  trial_end?: number | null;
  cancel_at_period_end?: boolean | null;
  current_period_end?: number | null;
  items?: { data?: { current_period_end?: number | null }[] | null } | null;
  customer?: string | { id: string } | null;
  metadata?: Record<string, string> | null;
};

export type WebhookEvent = {
  id?: string;
  type: string;
  data: { object: any; previous_attributes?: Record<string, unknown> | null };
};

export type WebhookOutcome = {
  userId: number | null;
  /** For the route's fallback lookup (User.stripeCustomerId) when metadata carries no userId. */
  customerId: string | null;
  data: Partial<{
    subscriptionStatus: SubscriptionStatus;
    trialEndsAt: Date | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
    stripeSubscriptionId: string;
    stripeCustomerId: string;
  }>;
  funnel?: FunnelEventName;
  ignored?: string;
  /** A transactional email the route should fire-and-forget (#121): no data
   *  write, just a send. Only "trial_ending" exists today. */
  email?: "trial_ending";
};

/** What the route already knows when it applies an event: the user row the
 *  event resolved to (null = not found) and, for event types whose object
 *  carries only a subscription id, the retrieved subscription. */
export type WebhookContext = {
  user: { id: number; stripeSubscriptionId: string | null; subscriptionStatus: string | null; cancelAtPeriodEnd?: boolean | null } | null;
  subscription?: StripeSubscriptionShape | null;
  /** Epoch ms "now" for time-sensitive rules (trial_will_end); defaults to Date.now(). */
  now?: number;
};

/** The trial-ending email is pointless (and misleading) once the end is this
 *  close: a trial ended immediately, or the event arrived late. */
export const TRIAL_ENDING_MIN_LEAD_MS = 24 * 60 * 60 * 1000;

/** Event types the route RETRIEVES the subscription for before mapping. Never
 *  map a status from an event snapshot: webhooks arrive out of order, and a
 *  delayed `updated(active)` landing after `deleted` would resurrect a canceled
 *  account. The retrieved object is Stripe's current truth. (`deleted` is the
 *  exception — a deleted subscription cannot come back as active.) */
export const EVENTS_NEEDING_SUBSCRIPTION: ReadonlySet<string> = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "invoice.payment_failed",
  "invoice.paid",
  "invoice.payment_succeeded",
]);

function idOf(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id ?? null;
}

function parseUserId(meta: Record<string, string> | null | undefined): number | null {
  const raw = meta?.userId;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** The invoice's subscription id: pre-basil `invoice.subscription`, basil
 *  `invoice.parent.subscription_details.subscription`. */
function invoiceSubscriptionId(inv: any): string | null {
  return idOf(inv?.subscription) ?? idOf(inv?.parent?.subscription_details?.subscription);
}

/** Who an event is about, read from the event alone: our userId (from the
 *  metadata we stamp on sessions and subscriptions), the Stripe customer id
 *  (fallback lookup), and the subscription id (for retrieval / matching). */
export function subjectFromEvent(event: WebhookEvent): { userId: number | null; customerId: string | null; subscriptionId: string | null } {
  const o = event.data.object ?? {};
  if (event.type.startsWith("invoice.")) {
    const meta = o.parent?.subscription_details?.metadata ?? o.subscription_details?.metadata ?? null;
    return { userId: parseUserId(meta), customerId: idOf(o.customer), subscriptionId: invoiceSubscriptionId(o) };
  }
  if (event.type === "checkout.session.completed") {
    return { userId: parseUserId(o.metadata), customerId: idOf(o.customer), subscriptionId: idOf(o.subscription) };
  }
  if (event.type.startsWith("customer.subscription.")) {
    return { userId: parseUserId(o.metadata), customerId: idOf(o.customer), subscriptionId: typeof o.id === "string" ? o.id : null };
  }
  return { userId: parseUserId(o.metadata), customerId: idOf(o.customer), subscriptionId: null };
}

/** Period fields shared by every subscription-shaped outcome. */
function periodFields(sub: StripeSubscriptionShape): { currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean } {
  const end = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
  return { currentPeriodEnd: end ? new Date(end * 1000) : null, cancelAtPeriodEnd: sub.cancel_at_period_end === true };
}

/** Funnel milestone for a status transition, decided from the DB's previous
 *  status so the FIRST event to observe it logs it and later ones don't. */
function transitionFunnel(prev: string | null | undefined, next: SubscriptionStatus): FunnelEventName | undefined {
  if (prev === next) return undefined;
  if (next === "active" && prev === "trialing") return "trial_converted";
  if (next === "past_due") return "payment_failed";
  if (next === "canceled") return "canceled";
  return undefined;
}

/** THE webhook rule: one event (+ what the route knows) → fields to write, a
 *  funnel milestone, or a reason to ignore. Pure; never touches Stripe or the DB. */
export function outcomeFromEvent(event: WebhookEvent, ctx: WebhookContext = { user: null }): WebhookOutcome {
  const { userId, customerId, subscriptionId } = subjectFromEvent(event);
  const base: WebhookOutcome = { userId, customerId, data: {} };
  const ignore = (why: string): WebhookOutcome => ({ ...base, ignored: why });
  const user = ctx.user;
  const o = event.data.object ?? {};

  switch (event.type) {
    case "checkout.session.completed": {
      const sub = ctx.subscription ?? (o.subscription && typeof o.subscription === "object" ? (o.subscription as StripeSubscriptionShape) : null);
      if (!sub) return ignore("subscription not expanded");
      const fields = subscriptionFieldsFromSession({ ...o, subscription: sub });
      if (!fields) return ignore("session not complete or subscription not live");
      return { ...base, data: { ...fields, ...periodFields(sub) }, funnel: "checkout_completed" };
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      // Status comes from the RETRIEVED subscription (current truth), never the
      // event snapshot — see EVENTS_NEEDING_SUBSCRIPTION.
      const sub = ctx.subscription;
      if (!sub) return ignore("subscription not retrieved");
      if (sub.id !== subscriptionId) return ignore("retrieved subscription does not match the event");
      const mapped = statusFromStripeSubscription(sub);
      if (!mapped) return ignore(`unmapped subscription status: ${sub.status}`);
      // A restart (none/canceled) adopts the new subscription; otherwise only
      // events for the subscription on file may write (a late event for an
      // old subscription must not touch the new one).
      if (user?.stripeSubscriptionId && user.stripeSubscriptionId !== sub.id && !needsCheckout(user.subscriptionStatus)) {
        return ignore("event for a subscription that is not the one on file");
      }
      const period = periodFields(sub);
      const prevCancel = event.data.previous_attributes?.cancel_at_period_end;
      const funnel =
        period.cancelAtPeriodEnd && prevCancel === false ? "cancel_scheduled" : transitionFunnel(user?.subscriptionStatus, mapped.subscriptionStatus);
      const stripeCustomerId = idOf(sub.customer);
      return {
        ...base,
        data: { ...mapped, ...period, stripeSubscriptionId: sub.id, ...(stripeCustomerId ? { stripeCustomerId } : {}) },
        funnel,
      };
    }

    case "customer.subscription.deleted": {
      const sub = o as StripeSubscriptionShape;
      if (user?.stripeSubscriptionId && user.stripeSubscriptionId !== sub.id) return ignore("deleted subscription is not the one on file");
      // The event itself is the fact (Stripe's object says "canceled" too) —
      // still mapped through the one table so the vocabulary has one owner.
      const mapped = statusFromStripeSubscription({ status: "canceled", trial_end: null });
      if (!mapped) return ignore("unmapped");
      return {
        ...base,
        data: { subscriptionStatus: mapped.subscriptionStatus, trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false },
        funnel: transitionFunnel(user?.subscriptionStatus, mapped.subscriptionStatus),
      };
    }

    case "invoice.payment_failed": {
      if (!subscriptionId) return ignore("invoice has no subscription");
      if (!user?.stripeSubscriptionId || user.stripeSubscriptionId !== subscriptionId) return ignore("invoice subscription does not match the one on file");
      // Stripe has already moved the subscription to past_due (or, if a retry
      // succeeded / it was canceled meanwhile, elsewhere): write what it says NOW.
      const sub = ctx.subscription;
      if (!sub) return ignore("subscription not retrieved");
      const mapped = statusFromStripeSubscription(sub);
      if (!mapped) return ignore(`unmapped subscription status: ${sub.status}`);
      return { ...base, data: { ...mapped, ...periodFields(sub) }, funnel: transitionFunnel(user.subscriptionStatus, mapped.subscriptionStatus) };
    }

    case "invoice.paid":
    case "invoice.payment_succeeded": {
      if (!subscriptionId) return ignore("invoice has no subscription");
      if (!user?.stripeSubscriptionId || user.stripeSubscriptionId !== subscriptionId) return ignore("invoice subscription does not match the one on file");
      const sub = ctx.subscription;
      if (!sub) return ignore("subscription not retrieved");
      const mapped = statusFromStripeSubscription(sub);
      if (!mapped || mapped.subscriptionStatus !== "active") return ignore(`subscription not active (${sub.status})`);
      return { ...base, data: { ...mapped, ...periodFields(sub) }, funnel: transitionFunnel(user.subscriptionStatus, mapped.subscriptionStatus) };
    }

    case "customer.subscription.trial_will_end": {
      // #121: the trial-ending email. Writes NOTHING — the status flip comes
      // from `updated`/`invoice.paid` at the real trial end. The date in the
      // email is read from the event SNAPSHOT (`trial_end`), not a retrieval:
      // it is informational copy, no status is mapped from it, and a trial's
      // end does not move between Stripe firing this event (3 days out) and
      // us receiving it — so the extra Stripe call buys nothing and this type
      // deliberately stays out of EVENTS_NEEDING_SUBSCRIPTION.
      const sub = o as StripeSubscriptionShape;
      if (user?.stripeSubscriptionId && user.stripeSubscriptionId !== sub.id) return ignore("trial_will_end: not the subscription on file");
      // Only a trialing account gets it (isTrialing — never a raw comparison).
      if (!isTrialing(user?.subscriptionStatus)) return ignore("trial_will_end: account is not trialing");
      // Already canceled at period end (DB or the event itself) → nothing will
      // be charged, so a "here's what you'll be charged" email would be false.
      if (user?.cancelAtPeriodEnd || sub.cancel_at_period_end === true) return ignore("trial_will_end: cancel already scheduled");
      // No email after the fact: without a trial_end there is no honest date,
      // and inside the last 24h (trial ended immediately, or a late delivery)
      // "ends in a few days" would already be false.
      if (!sub.trial_end) return ignore("trial_will_end: no trial_end on the event");
      if (sub.trial_end * 1000 - (ctx.now ?? Date.now()) < TRIAL_ENDING_MIN_LEAD_MS) return ignore("trial_will_end: too close to the end");
      return { ...base, data: {}, email: "trial_ending" };
    }

    default:
      return ignore(`unhandled event type: ${event.type}`);
  }
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

/** The Billing Portal needs at least one active configuration that lets a
 *  customer update their payment method (#119 past-due) AND cancel at the end
 *  of the billing period (#109 one-click cancel; `mode: "at_period_end"` is
 *  what keeps access until currentPeriodEnd — "immediately" would break it). */
export function portalCheck(
  configs:
    | {
        active: boolean;
        is_default?: boolean;
        features?: { subscription_cancel?: { enabled?: boolean; mode?: string }; payment_method_update?: { enabled?: boolean } };
      }[]
    | null,
): HealthCheck {
  const name = "Billing portal";
  if (!configs) return { name, ok: false, detail: "unavailable" };
  const active = configs.filter((c) => c.active);
  if (active.length === 0) return { name, ok: false, detail: "no active configuration" };
  const updatable = active.filter((c) => c.features?.payment_method_update?.enabled === true);
  if (updatable.length === 0) return { name, ok: false, detail: `${active.length} active, none allow payment-method update` };
  const usable = updatable.filter((c) => c.features?.subscription_cancel?.enabled === true && c.features.subscription_cancel.mode === "at_period_end");
  if (usable.length === 0) {
    const anyCancel = updatable.some((c) => c.features?.subscription_cancel?.enabled === true);
    return { name, ok: false, detail: anyCancel ? "cancel enabled but not at_period_end" : "payment-method update enabled; cancel disabled" };
  }
  const dflt = usable.some((c) => c.is_default) ? "default config" : "non-default config";
  return { name, ok: true, detail: `payment-method update enabled; cancel at period end enabled (${dflt})` };
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
