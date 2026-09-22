import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin";
import { billingEnabled } from "@/lib/subscription";
import {
  stripe,
  priceId,
  keyMode,
  publishableMode,
  priceCheck,
  accountCheck,
  portalCheck,
  walletDomainCheck,
  expectedWalletHost,
  envPresence,
  modesAgreeCheck,
  overallOk,
  redactStripeIds,
  type HealthCheck,
} from "@/lib/stripe";

// GET /api/admin/billing-health — READ-ONLY verification of the Stripe setup in
// the environment this code is running in (the only place production secrets can
// be inspected). Asks Stripe four read-only questions and reports pass/fail rows.
// Output is safe to screenshot: no key material, no customer/price/account/config
// ids (Stripe error text is scrubbed). Never performs a Stripe write.
export const dynamic = "force-dynamic";

/** Per-request options: a short timeout and no retries so a Stripe stall becomes a
 *  failing row in a 200 JSON, not a Vercel 504. The shared client keeps Stripe's
 *  defaults (checkout/confirm rely on them). */
const REQUEST_OPTS = { timeout: 8000, maxNetworkRetries: 0 } as const;

/** Run one read-only Stripe call; a failure becomes a failing check, never a 500. */
async function attempt<T>(name: string, fn: () => Promise<T>): Promise<{ value: T | null; error: HealthCheck | null }> {
  try {
    return { value: await fn(), error: null };
  } catch (e) {
    const message = redactStripeIds(e instanceof Error ? e.message : String(e));
    console.error(`[billing-health] ${name}: ${message}`);
    return { value: null, error: { name, ok: false, detail: `Stripe error: ${message}` } };
  }
}

export const GET = withAdmin(async () => {
  const env = process.env;
  const generatedAt = new Date().toISOString();
  const secretMode = keyMode(env.STRIPE_SECRET_KEY);
  const pkMode = publishableMode(env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
  const checks: HealthCheck[] = envPresence(env);

  if (secretMode === "missing") {
    checks.push(modesAgreeCheck(secretMode, pkMode));
    return NextResponse.json({ generatedAt, mode: secretMode, billingEnabled: billingEnabled(), stripe: "not configured", checks, allOk: overallOk(checks) });
  }

  // Production expects live keys; only an explicit test key relaxes that.
  const expectedMode: "live" | "test" = secretMode === "test" ? "test" : "live";

  const host = expectedWalletHost(env.APP_URL);
  const [price, account, portal, wallet] = await Promise.all([
    attempt("Price", async () => stripe().prices.retrieve(priceId(), REQUEST_OPTS)),
    attempt("Account", async () => stripe().accounts.retrieve(REQUEST_OPTS)),
    attempt("Billing portal", async () => (await stripe().billingPortal.configurations.list({ limit: 10 }, REQUEST_OPTS)).data),
    attempt("Wallet domain", async () => (await stripe().paymentMethodDomains.list({ domain_name: host, enabled: true }, REQUEST_OPTS)).data),
  ]);

  checks.push(modesAgreeCheck(secretMode, pkMode, price.value?.livemode));
  checks.push(price.error ?? priceCheck(price.value, expectedMode));
  // On an account-call failure every named row fails with the same redacted
  // reason, so the reader still sees WHICH checks are unverified.
  checks.push(...(account.error ? accountCheck(null).map((c) => ({ ...c, detail: account.error!.detail })) : accountCheck(account.value)));
  checks.push(portal.error ?? portalCheck(portal.value));
  checks.push(wallet.error ?? walletDomainCheck(wallet.value, host));

  return NextResponse.json({ generatedAt, mode: secretMode, billingEnabled: billingEnabled(), checks, allOk: overallOk(checks) });
});
