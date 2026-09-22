// Admin billing-health (GET /api/admin/billing-health): the pure helpers that turn
// already-fetched Stripe shapes into screenshot-safe pass/fail rows, plus grep
// guards that the route stays admin-gated and READ-ONLY.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
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
  formatPrice,
  INFORMATIONAL_CHECKS,
  type HealthCheck,
} from "@/lib/stripe";
import { isBillingFlagOn } from "@/lib/subscription";

describe("keyMode / publishableMode", () => {
  it("reads live/test from the prefix, incl. restricted keys", () => {
    expect(keyMode("sk_live_abc")).toBe("live");
    expect(keyMode("sk_test_abc")).toBe("test");
    expect(keyMode("rk_live_abc")).toBe("live");
    expect(keyMode("rk_test_abc")).toBe("test");
    expect(publishableMode("pk_live_abc")).toBe("live");
    expect(publishableMode("pk_test_abc")).toBe("test");
  });
  it("missing for unset/empty, unknown for an unrecognised prefix", () => {
    expect(keyMode(undefined)).toBe("missing");
    expect(keyMode("   ")).toBe("missing");
    expect(keyMode("pk_live_abc")).toBe("unknown"); // a publishable key in the secret slot
    expect(publishableMode(undefined)).toBe("missing");
    expect(publishableMode("sk_live_abc")).toBe("unknown");
  });
});

describe("priceCheck", () => {
  const good = { active: true, currency: "usd", unit_amount: 499, recurring: { interval: "month", interval_count: 1 }, livemode: true };
  it("passes an active, monthly, priced, live price and formats via the ONE formatter", () => {
    const c = priceCheck(good, "live");
    expect(c.ok).toBe(true);
    expect(c.detail).toBe(`${formatPrice(good)}, live`);
    expect(c.detail).toBe("$4.99/month, live");
  });
  it("fails an inactive price", () => {
    const c = priceCheck({ ...good, active: false }, "live");
    expect(c.ok).toBe(false);
    expect(c.detail).toContain("inactive");
  });
  it("fails a yearly or multi-month price", () => {
    expect(priceCheck({ ...good, recurring: { interval: "year", interval_count: 1 } }, "live").ok).toBe(false);
    expect(priceCheck({ ...good, recurring: { interval: "month", interval_count: 3 } }, "live").ok).toBe(false);
    expect(priceCheck({ ...good, recurring: null }, "live").detail).toContain("not recurring");
  });
  it("fails a zero/null amount", () => {
    expect(priceCheck({ ...good, unit_amount: 0 }, "live").ok).toBe(false);
    expect(priceCheck({ ...good, unit_amount: null }, "live").ok).toBe(false);
  });
  it("fails when the price mode differs from the keys", () => {
    const c = priceCheck({ ...good, livemode: false }, "live");
    expect(c.ok).toBe(false);
    expect(c.detail).toContain("mode mismatch");
    expect(priceCheck({ ...good, livemode: false }, "test").ok).toBe(true);
  });
  it("null → failing 'unavailable'", () => {
    expect(priceCheck(null, "live")).toEqual({ name: "Price", ok: false, detail: "unavailable" });
  });
  it("never hardcodes the amount", () => {
    expect(priceCheck({ ...good, unit_amount: 1299 }, "live").detail).toBe("$12.99/month, live");
  });
});

describe("accountCheck", () => {
  it("three checks from the account flags; descriptor text is shown (public on receipts)", () => {
    const rows = accountCheck({ charges_enabled: true, payouts_enabled: true, details_submitted: true, settings: { payments: { statement_descriptor: "NAVO LEARNING" } } });
    expect(rows.map((r) => [r.name, r.ok])).toEqual([
      ["Charges enabled", true],
      ["Payouts enabled", true],
      ["Statement descriptor", true],
    ]);
    expect(rows[2].detail).toBe('"NAVO LEARNING"');
  });
  it("fails each disabled flag and an empty descriptor", () => {
    const rows = accountCheck({ charges_enabled: false, payouts_enabled: false, details_submitted: false, settings: { payments: { statement_descriptor: "  " } } });
    expect(rows.every((r) => !r.ok)).toBe(true);
    expect(rows[0].detail).toContain("not submitted");
    expect(rows[2].detail).toBe("not set");
  });
  it("null → three failing 'unavailable' rows", () => {
    const rows = accountCheck(null);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => !r.ok && r.detail === "unavailable")).toBe(true);
  });
});

describe("portalCheck", () => {
  it("passes with an active config allowing payment-method update; notes cancel state", () => {
    const c = portalCheck([{ active: true, is_default: true, features: { payment_method_update: { enabled: true }, subscription_cancel: { enabled: false } } }]);
    expect(c.ok).toBe(true);
    expect(c.detail).toContain("cancel disabled");
    expect(c.detail).toContain("default config");
    expect(portalCheck([{ active: true, features: { payment_method_update: { enabled: true }, subscription_cancel: { enabled: true } } }]).detail).toContain("cancel enabled");
  });
  it("fails without payment-method update, without active configs, or with null", () => {
    expect(portalCheck([{ active: true, features: { payment_method_update: { enabled: false } } }]).ok).toBe(false);
    expect(portalCheck([{ active: false, features: { payment_method_update: { enabled: true } } }]).ok).toBe(false);
    expect(portalCheck([]).detail).toBe("no active configuration");
    expect(portalCheck(null).detail).toBe("unavailable");
  });
});

describe("walletDomainCheck / expectedWalletHost (Payment Method Domains)", () => {
  const active = { status: "active" };
  const domains = [
    { domain_name: "App.NavoLearning.com", enabled: true, apple_pay: active, google_pay: active, link: active },
    { domain_name: "pinnavel.com", enabled: false, apple_pay: active, google_pay: active, link: active },
  ];
  it("matches case-insensitively and reports all three wallet statuses", () => {
    const c = walletDomainCheck(domains, "app.navolearning.com");
    expect(c.ok).toBe(true);
    expect(c.detail).toBe("app.navolearning.com: Apple Pay active, Google Pay active, Link active");
    expect(walletDomainCheck(domains, "APP.NAVOLEARNING.COM").ok).toBe(true);
  });
  it("requires apple_pay.status === active; other statuses are reported but do not gate", () => {
    const inactiveApple = [{ ...domains[0], apple_pay: { status: "inactive" } }];
    const c = walletDomainCheck(inactiveApple, "app.navolearning.com");
    expect(c.ok).toBe(false);
    expect(c.detail).toContain("Apple Pay inactive");
    const inactiveGoogle = [{ ...domains[0], google_pay: { status: "inactive" }, link: undefined }];
    const g = walletDomainCheck(inactiveGoogle, "app.navolearning.com");
    expect(g.ok).toBe(true);
    expect(g.detail).toBe("app.navolearning.com: Apple Pay active, Google Pay inactive, Link unknown");
  });
  it("fails on mismatch, a disabled domain, an empty list, or null", () => {
    expect(walletDomainCheck(domains, "navolearning.com").ok).toBe(false);
    expect(walletDomainCheck(domains, "pinnavel.com").ok).toBe(false);
    expect(walletDomainCheck([], "app.navolearning.com").detail).toBe("app.navolearning.com: no enabled payment method domain");
    expect(walletDomainCheck(null, "app.navolearning.com").detail).toBe("unavailable");
  });
  it("expected host = APP_URL's hostname, else the production app host", () => {
    expect(expectedWalletHost("https://app.navolearning.com/")).toBe("app.navolearning.com");
    expect(expectedWalletHost("https://Pinnavel.com/x?y=1")).toBe("pinnavel.com");
    expect(expectedWalletHost(undefined)).toBe("app.navolearning.com");
    expect(expectedWalletHost("not a url")).toBe("app.navolearning.com");
  });
});

describe("envPresence", () => {
  const full = {
    STRIPE_SECRET_KEY: "sk_live_x",
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_x",
    STRIPE_PRICE_ID: "price_x",
    APP_URL: "https://app.navolearning.com",
    STRIPE_WEBHOOK_SECRET: "whsec_x",
    BILLING_ENABLED: "1",
  };
  it("reports presence only — never a value", () => {
    const rows = envPresence(full);
    expect(rows.map((r) => r.name)).toEqual(["STRIPE_SECRET_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "STRIPE_PRICE_ID", "APP_URL", "STRIPE_WEBHOOK_SECRET", "BILLING_ENABLED"]);
    expect(rows.slice(0, 5).every((r) => r.ok && r.detail === "present")).toBe(true);
    for (const r of rows) for (const v of Object.values(full)) expect(r.detail.includes(v)).toBe(false);
  });
  it("missing / empty values fail; the webhook secret explains it is expected until #109", () => {
    const rows = envPresence({ ...full, STRIPE_PRICE_ID: "  ", STRIPE_WEBHOOK_SECRET: undefined });
    expect(rows.find((r) => r.name === "STRIPE_PRICE_ID")).toEqual({ name: "STRIPE_PRICE_ID", ok: false, detail: "missing" });
    expect(rows.find((r) => r.name === "STRIPE_WEBHOOK_SECRET")).toEqual({ name: "STRIPE_WEBHOOK_SECRET", ok: false, detail: "missing (expected until #109 webhooks)" });
  });
  it("BILLING_ENABLED is informational: always ok, state made obvious, same parse as billingEnabled()", () => {
    expect(envPresence(full).at(-1)).toEqual({ name: "BILLING_ENABLED", ok: true, detail: "ON" });
    expect(envPresence({ ...full, BILLING_ENABLED: undefined }).at(-1)).toEqual({ name: "BILLING_ENABLED", ok: true, detail: "OFF (unset)" });
    expect(envPresence({ ...full, BILLING_ENABLED: "0" }).at(-1)?.detail).toBe("OFF (set, but not a true value)");
    expect(isBillingFlagOn("true")).toBe(true);
    expect(isBillingFlagOn("1")).toBe(true);
    expect(isBillingFlagOn("false")).toBe(false);
    expect(isBillingFlagOn(undefined)).toBe(false);
  });
  it("the master switch is byte-exact: a padded value stays OFF (no trim — prod behaves as before)", () => {
    expect(isBillingFlagOn("true ")).toBe(false);
    expect(isBillingFlagOn(" 1")).toBe(false);
    expect(envPresence({ ...full, BILLING_ENABLED: "true " }).at(-1)?.detail).toBe("OFF (set, but not a true value)");
  });
});

describe("modesAgreeCheck", () => {
  it("ok iff secret === publishable ∈ {live,test} and price (when known) matches", () => {
    expect(modesAgreeCheck("live", "live").ok).toBe(true);
    expect(modesAgreeCheck("live", "live", true).ok).toBe(true);
    expect(modesAgreeCheck("test", "test", false).ok).toBe(true);
    expect(modesAgreeCheck("live", "test").ok).toBe(false);
    expect(modesAgreeCheck("live", "live", false).ok).toBe(false);
    expect(modesAgreeCheck("missing", "missing").ok).toBe(false);
    expect(modesAgreeCheck("unknown", "unknown").ok).toBe(false);
    expect(modesAgreeCheck("live", "test", true).detail).toBe("secret live, publishable test, price live");
  });
});

describe("overallOk", () => {
  const ok = (name: string): HealthCheck => ({ name, ok: true, detail: "" });
  const bad = (name: string): HealthCheck => ({ name, ok: false, detail: "" });
  it("ignores the two informational checks and fails on any other failure", () => {
    expect([...INFORMATIONAL_CHECKS].sort()).toEqual(["BILLING_ENABLED", "STRIPE_WEBHOOK_SECRET"]);
    expect(overallOk([ok("Price"), bad("STRIPE_WEBHOOK_SECRET"), ok("BILLING_ENABLED")])).toBe(true);
    expect(overallOk([bad("Price"), ok("STRIPE_WEBHOOK_SECRET")])).toBe(false);
    expect(overallOk([])).toBe(true);
  });
});

describe("redactStripeIds", () => {
  it("scrubs Stripe object ids and key material out of error text", () => {
    expect(redactStripeIds("No such price: 'price_1Abc23DEF'")).toBe("No such price: '[redacted]'");
    expect(redactStripeIds("Invalid API Key provided: sk_live_****abcd")).toBe("Invalid API Key provided: [redacted]");
    expect(redactStripeIds("acct_123 cus_456 sub_789 whsec_000")).toBe("[redacted] [redacted] [redacted] [redacted]");
    expect(redactStripeIds("pmd_1X apwc_2Y pmc_3Z req_4W")).toBe("[redacted] [redacted] [redacted] [redacted]");
    expect(redactStripeIds("Rate limited")).toBe("Rate limited");
  });
});

describe("grep guard: the route is admin-gated and READ-ONLY", () => {
  const src = readFileSync("app/api/admin/billing-health/route.ts", "utf8");
  it("wraps GET in withAdmin( and is force-dynamic", () => {
    expect(src.includes("export const GET = withAdmin(")).toBe(true);
    expect(src.includes('export const dynamic = "force-dynamic"')).toBe(true);
  });
  it("performs no Stripe writes", () => {
    for (const write of [".create(", ".update(", ".del(", ".cancel(", ".capture(", ".confirm(", ".attach("]) {
      expect(src.includes(write), `forbidden call ${write}`).toBe(false);
    }
    expect(src.includes("prisma")).toBe(false); // no DB writes either
  });
  it("only ever reads the four allowed endpoints, with no aliasing of the client", () => {
    expect(src.match(/stripe\(\)/g)?.length).toBe(4);
    const calls = [...src.matchAll(/stripe\(\)\.([\w.]+)\(/g)].map((m) => m[1]).sort();
    expect(calls).toEqual(["accounts.retrieve", "billingPortal.configurations.list", "paymentMethodDomains.list", "prices.retrieve"]);
    expect(src.includes("applePayDomains")).toBe(false);
  });
  it("every Stripe call carries the short-timeout / no-retry request options", () => {
    expect(src.match(/REQUEST_OPTS\)/g)?.length).toBe(4);
    expect(src.includes("timeout: 8000")).toBe(true);
    expect(src.includes("maxNetworkRetries: 0")).toBe(true);
  });
  it("scrubs error text and passes the error through redactStripeIds", () => {
    expect(src.includes("redactStripeIds(")).toBe(true);
  });
});
