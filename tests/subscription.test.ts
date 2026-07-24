// #117: the single-source billing vocabulary + fire-and-forget funnel contract.
import { describe, it, expect } from "vitest";
import { asStatus, hasAppAccess, needsCheckout, postDemoDestination, SUBSCRIPTION_STATUSES } from "@/lib/subscription";
import { logEvent } from "@/lib/funnel";

describe("subscription status vocabulary", () => {
  it("grandfathered, trialing, active have app access; the rest do not", () => {
    expect(hasAppAccess("grandfathered")).toBe(true);
    expect(hasAppAccess("trialing")).toBe(true);
    expect(hasAppAccess("active")).toBe(true);
    expect(hasAppAccess("none")).toBe(false);
    expect(hasAppAccess("past_due")).toBe(false);
    expect(hasAppAccess("canceled")).toBe(false);
  });
  it("unknown/null status fails CLOSED to none (card page, never free access)", () => {
    expect(asStatus(null)).toBe("none");
    expect(asStatus(undefined)).toBe("none");
    expect(asStatus("weird-future-value")).toBe("none");
    expect(hasAppAccess("weird-future-value")).toBe(false);
    expect(needsCheckout("weird-future-value")).toBe(true);
  });
  it("only 'none' needs checkout", () => {
    for (const s of SUBSCRIPTION_STATUSES) expect(needsCheckout(s)).toBe(s === "none");
  });
});

describe("post-demo destination (signup → demo → card → app)", () => {
  it("billing on + none → the card page", () => {
    expect(postDemoDestination("none", true, false)).toBe("/welcome/card");
  });
  it("billing off, or already subscribed, or grandfathered, or admin → dashboard", () => {
    expect(postDemoDestination("none", false, false)).toBe("/dashboard?welcome=1");
    expect(postDemoDestination("trialing", true, false)).toBe("/dashboard?welcome=1");
    expect(postDemoDestination("grandfathered", true, false)).toBe("/dashboard?welcome=1");
    expect(postDemoDestination("none", true, true)).toBe("/dashboard?welcome=1");
  });
});

describe("funnel logging never throws", () => {
  it("a failing insert is swallowed", async () => {
    const throwing = { funnelEvent: { create: async () => { throw new Error("db down"); } } };
    await expect(logEvent("signup_created", 1, { x: 1 }, throwing)).resolves.toBeUndefined();
  });
});
