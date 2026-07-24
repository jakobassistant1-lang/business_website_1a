// #118: the pure billing helpers — session ownership + field mapping. The full
// money-loop rehearsal (test clocks, declines, cancels) is ticket #127.
import { describe, it, expect } from "vitest";
import { sessionBelongsTo, subscriptionFieldsFromSession } from "@/lib/stripe";

describe("sessionBelongsTo (a session id is not a capability)", () => {
  it("matches only the owning user's id", () => {
    expect(sessionBelongsTo({ metadata: { userId: "7" } }, 7)).toBe(true);
    expect(sessionBelongsTo({ metadata: { userId: "7" } }, 8)).toBe(false);
    expect(sessionBelongsTo({ metadata: {} }, 7)).toBe(false);
    expect(sessionBelongsTo({ metadata: null }, 7)).toBe(false);
  });
});

describe("subscriptionFieldsFromSession", () => {
  const complete = {
    status: "complete",
    customer: "cus_123",
    subscription: { id: "sub_456", status: "trialing", trial_end: 1_755_000_000 },
  };
  it("maps a complete trialing session to our fields", () => {
    const f = subscriptionFieldsFromSession(complete);
    expect(f).toEqual({
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_456",
      subscriptionStatus: "trialing",
      trialEndsAt: new Date(1_755_000_000 * 1000),
    });
  });
  it("handles an expanded customer object and an already-active sub", () => {
    const f = subscriptionFieldsFromSession({ ...complete, customer: { id: "cus_123" }, subscription: { id: "sub_456", status: "active", trial_end: null } });
    expect(f?.stripeCustomerId).toBe("cus_123");
    expect(f?.subscriptionStatus).toBe("active");
    expect(f?.trialEndsAt).toBeNull();
  });
  it("returns null for incomplete, unexpanded, or customer-less sessions", () => {
    expect(subscriptionFieldsFromSession({ ...complete, status: "open" })).toBeNull();
    expect(subscriptionFieldsFromSession({ ...complete, subscription: "sub_456" })).toBeNull();
    expect(subscriptionFieldsFromSession({ ...complete, subscription: null })).toBeNull();
    expect(subscriptionFieldsFromSession({ ...complete, customer: null })).toBeNull();
  });
});
