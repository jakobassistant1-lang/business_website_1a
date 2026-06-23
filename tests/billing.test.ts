import { describe, it, expect, vi, afterEach } from "vitest";
import { createHmac } from "crypto";
import { isBillingConfigured, hasActiveAccess, verifyStripeWebhook } from "@/lib/billing";

// Pure-helper tests only — no real network, no DB. Env is stubbed per-test and
// restored in afterEach (mirrors tests/email.test.ts / tests/googleAuth.test.ts).
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function stubBillingOn() {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
  vi.stubEnv("STRIPE_PRICE_ID", "price_123");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
}

describe("isBillingConfigured", () => {
  it("is false when the Stripe vars are unset (billing OFF)", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STRIPE_PRICE_ID", "");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    expect(isBillingConfigured()).toBe(false);
  });

  it("is true only when all three vars are present", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
    vi.stubEnv("STRIPE_PRICE_ID", "price_123");
    expect(isBillingConfigured()).toBe(false); // webhook secret still missing
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
    expect(isBillingConfigured()).toBe(true);
  });
});

describe("hasActiveAccess", () => {
  it("returns true for ANY user when billing is OFF (no paywall — the linchpin)", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STRIPE_PRICE_ID", "");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    expect(hasActiveAccess({ subscriptionStatus: null })).toBe(true);
    expect(hasActiveAccess({ subscriptionStatus: "canceled" })).toBe(true);
  });

  it("gates by subscriptionStatus when billing is ON", () => {
    stubBillingOn();
    expect(hasActiveAccess({ subscriptionStatus: "trialing" })).toBe(true);
    expect(hasActiveAccess({ subscriptionStatus: "active" })).toBe(true);
    expect(hasActiveAccess({ subscriptionStatus: "past_due" })).toBe(true);
    expect(hasActiveAccess({ subscriptionStatus: "canceled" })).toBe(false);
    expect(hasActiveAccess({ subscriptionStatus: null })).toBe(false);
  });
});

describe("verifyStripeWebhook", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ id: "evt_1", type: "customer.subscription.updated" });

  function signature(payload: string, t = "1700000000", sec = secret): string {
    const v1 = createHmac("sha256", sec).update(`${t}.${payload}`).digest("hex");
    return `t=${t},v1=${v1}`;
  }

  it("accepts a correctly-HMAC'd payload", () => {
    stubBillingOn();
    expect(verifyStripeWebhook(body, signature(body))).toBe(true);
  });

  it("rejects a tampered payload", () => {
    stubBillingOn();
    const sig = signature(body); // signed over the original body
    expect(verifyStripeWebhook(body + "tampered", sig)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    stubBillingOn();
    expect(verifyStripeWebhook(body, signature(body, "1700000000", "whsec_wrong"))).toBe(false);
  });

  it("rejects a malformed signature header", () => {
    stubBillingOn();
    expect(verifyStripeWebhook(body, "garbage")).toBe(false);
    expect(verifyStripeWebhook(body, "")).toBe(false);
  });
});
