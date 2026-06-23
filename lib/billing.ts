// Stripe billing — INERT until configured. Talks to Stripe's REST API directly
// via fetch (no SDK → no new dependency, matching lib/email.ts) and verifies
// webhooks with node crypto HMAC-SHA256 (matching the HMAC in lib/googleAuth.ts).
// Server-only — never import this into client code.
//
// The linchpin that keeps the live app unchanged: when Stripe env is NOT set,
// isBillingConfigured() is false and hasActiveAccess() returns TRUE for everyone
// (no paywall). Every function that needs config guards on isBillingConfigured()
// and no-ops / throws a typed error when it's off, with a loud-once-in-prod
// console.error (mirrors lib/email.ts / lib/crypto.ts).

import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "./prisma";
import { appOrigin } from "./appUrl";

const CHECKOUT_URL = "https://api.stripe.com/v1/checkout/sessions";
const PORTAL_URL = "https://api.stripe.com/v1/billing_portal/sessions";

const FETCH_TIMEOUT_MS = 10_000;
const TRIAL_PERIOD_DAYS = 7;

// Stripe subscription statuses that grant access to the app. "past_due" is
// included on purpose: a card that just failed shouldn't lock the student out
// instantly — Stripe retries and the portal lets them fix it.
const ACTIVE_STATUSES = new Set(["trialing", "active", "past_due"]);

/** True only when all three Stripe secrets are present. */
export function isBillingConfigured(): boolean {
  return Boolean(
    process.env.STRIPE_SECRET_KEY &&
      process.env.STRIPE_PRICE_ID &&
      process.env.STRIPE_WEBHOOK_SECRET,
  );
}

/**
 * Whether a user may use the app. When billing is OFF (no Stripe env) this is
 * ALWAYS true — there is no paywall, so the live app is unchanged. When billing
 * is ON, access is gated by the user's subscriptionStatus.
 */
export function hasActiveAccess(user: { subscriptionStatus: string | null }): boolean {
  if (!isBillingConfigured()) return true; // no paywall when billing is off
  return user.subscriptionStatus != null && ACTIVE_STATUSES.has(user.subscriptionStatus);
}

// Thrown by the config-needing functions when Stripe isn't configured. The API
// routes catch the unconfigured case earlier (404), so callers should never hit
// this in practice — it's a typed guard, not a user-facing path.
export class BillingNotConfiguredError extends Error {
  constructor() {
    super("billing_not_configured");
    this.name = "BillingNotConfiguredError";
  }
}

let warnedNotConfigured = false;
/** Loud, once, in production: a billing action was attempted with no Stripe env. */
function guardConfigured(): void {
  if (isBillingConfigured()) return;
  if (process.env.NODE_ENV === "production" && !warnedNotConfigured) {
    warnedNotConfigured = true;
    console.error(
      "[billing] STRIPE_SECRET_KEY/STRIPE_PRICE_ID/STRIPE_WEBHOOK_SECRET not set — " +
        "a billing action was attempted but Stripe is OFF. Set them to enable billing.",
    );
  }
  throw new BillingNotConfiguredError();
}

async function fetchWithTimeout(input: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** POST to Stripe's form-encoded REST API with the secret key as a Bearer token. */
async function stripePost(url: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY ?? ""}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[billing] Stripe POST ${url} failed (${res.status})`, detail.slice(0, 500));
    throw new Error(`stripe_request_failed_${res.status}`);
  }
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

type BillingUser = {
  id: number;
  email: string;
  stripeCustomerId: string | null;
};

/**
 * Create a Stripe Checkout session for a 7-day-trial subscription and return its
 * hosted URL. Reuses the user's stored stripeCustomerId if present; otherwise
 * passes customer_email so Stripe makes (and the webhook later stores) one.
 */
export async function createCheckoutSession(user: BillingUser, requestOrigin?: string): Promise<string> {
  guardConfigured();
  const base = appOrigin(requestOrigin ?? "");

  const params: Record<string, string> = {
    mode: "subscription",
    "line_items[0][price]": process.env.STRIPE_PRICE_ID ?? "",
    "line_items[0][quantity]": "1",
    "subscription_data[trial_period_days]": String(TRIAL_PERIOD_DAYS),
    success_url: `${base}/dashboard?checkout=success`,
    cancel_url: `${base}/billing?checkout=cancelled`,
  };
  // Tie the session to a customer we already know, or let Stripe create one keyed
  // to this email (the webhook stores the resulting id back on the user).
  if (user.stripeCustomerId) params.customer = user.stripeCustomerId;
  else params.customer_email = user.email;

  const session = await stripePost(CHECKOUT_URL, params);
  const url = typeof session.url === "string" ? session.url : "";
  if (!url) throw new Error("stripe_no_checkout_url");
  return url;
}

/**
 * Create a Stripe Billing Portal session (where the user manages or cancels the
 * subscription) and return its URL. Requires a known stripeCustomerId.
 */
export async function createBillingPortalSession(user: BillingUser, requestOrigin?: string): Promise<string> {
  guardConfigured();
  if (!user.stripeCustomerId) throw new Error("stripe_no_customer");
  const base = appOrigin(requestOrigin ?? "");
  const returnUrl = process.env.STRIPE_PORTAL_RETURN_URL?.trim() || `${base}/account`;

  const session = await stripePost(PORTAL_URL, {
    customer: user.stripeCustomerId,
    return_url: returnUrl,
  });
  const url = typeof session.url === "string" ? session.url : "";
  if (!url) throw new Error("stripe_no_portal_url");
  return url;
}

/**
 * Verify a Stripe webhook signature. Parses the Stripe-Signature header (which
 * looks like `t=1492774577,v1=<hex>,...`), recomputes HMAC-SHA256 of
 * `${t}.${rawBody}` with STRIPE_WEBHOOK_SECRET, and constant-time compares it to
 * the v1 signature. Returns false on anything malformed (mirrors the integrity
 * check in lib/googleAuth.ts's verifyLoginState).
 */
export function verifyStripeWebhook(rawBody: string, sigHeader: string): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !sigHeader) return false;

  let t = "";
  const v1: string[] = [];
  for (const part of sigHeader.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === "t") t = v;
    else if (k === "v1") v1.push(v);
  }
  if (!t || v1.length === 0) return false;

  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const expectedBuf = Buffer.from(expected);
  // A webhook may carry several v1 signatures (during a secret rotation); accept
  // if ANY matches, each via a length-checked constant-time compare.
  return v1.some((sig) => {
    const sigBuf = Buffer.from(sig);
    return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf);
  });
}

// A Stripe subscription object (only the fields we read). Stripe sends epoch
// seconds for timestamps and the status as a verbatim string.
type StripeSubscription = {
  id?: unknown;
  customer?: unknown;
  status?: unknown;
  trial_end?: unknown;
  current_period_end?: unknown;
};

function epochToDate(v: unknown): Date | null {
  return typeof v === "number" && Number.isFinite(v) ? new Date(v * 1000) : null;
}

/**
 * Apply a Stripe subscription object to the matching User (found by
 * stripeCustomerId). Writes subscriptionStatus / stripeSubscriptionId /
 * trialEndsAt / subscriptionCurrentPeriodEnd. Idempotent: it only writes the
 * mirrored fields, so re-running the same event is safe. No-ops if billing is
 * off or the customer isn't recognised.
 */
export async function applySubscriptionEvent(sub: StripeSubscription): Promise<void> {
  guardConfigured();
  const customerId = typeof sub.customer === "string" ? sub.customer : "";
  if (!customerId) return;

  const user = await prisma.user.findUnique({ where: { stripeCustomerId: customerId } });
  if (!user) return; // unknown customer — nothing to mirror (idempotent no-op)

  await prisma.user.update({
    where: { id: user.id },
    data: {
      stripeSubscriptionId: typeof sub.id === "string" ? sub.id : user.stripeSubscriptionId,
      subscriptionStatus: typeof sub.status === "string" ? sub.status : user.subscriptionStatus,
      trialEndsAt: epochToDate(sub.trial_end) ?? user.trialEndsAt,
      subscriptionCurrentPeriodEnd: epochToDate(sub.current_period_end) ?? user.subscriptionCurrentPeriodEnd,
    },
  });
}
