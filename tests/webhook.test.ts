// #109: Stripe webhooks. The pure event → outcome table (outcomeFromEvent), the
// route's trust boundary (raw body + signature, inert without the secret), its
// idempotency (StripeEvent by event id) and its "always 200 once verified"
// contract; plus the relaxed portal route and the /account card state table.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    stripeEvent: { create: vi.fn(), delete: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
    funnelEvent: { create: vi.fn() },
  },
}));
vi.mock("@/lib/stripe", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/stripe")>();
  return { ...real, stripe: vi.fn(), createPortalSession: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { stripe, createPortalSession, outcomeFromEvent, subjectFromEvent, portalReturnUrl, reconcileBillingFields, EVENTS_NEEDING_SUBSCRIPTION, type WebhookEvent } from "@/lib/stripe";
import { requireUser } from "@/lib/auth";
import { billingCardState, canManageBilling, SUBSCRIPTION_STATUSES } from "@/lib/subscription";
import { POST as webhookPOST } from "@/app/api/billing/webhook/route";
import { POST as portalPOST } from "@/app/api/billing/portal/route";

type Fn = ReturnType<typeof vi.fn>;
const vStripe = stripe as unknown as Fn;
const vPortal = createPortalSession as unknown as Fn;
const vUser = requireUser as unknown as Fn;
const vEvCreate = prisma.stripeEvent.create as unknown as Fn;
const vEvDelete = prisma.stripeEvent.delete as unknown as Fn;
const vFind = prisma.user.findUnique as unknown as Fn;
const vUpdate = prisma.user.update as unknown as Fn;

const T = 1_760_000_000; // a unix timestamp
const ev = (type: string, object: Record<string, unknown>, previous_attributes?: Record<string, unknown>): WebhookEvent => ({
  id: "evt_1",
  type,
  data: { object, ...(previous_attributes ? { previous_attributes } : {}) },
});
const sub = (over: Record<string, unknown> = {}) => ({
  id: "sub_1",
  status: "active",
  customer: "cus_1",
  metadata: { userId: "7" },
  trial_end: null,
  cancel_at_period_end: false,
  items: { data: [{ current_period_end: T }] },
  ...over,
});
const onFile = (subscriptionStatus: string, stripeSubscriptionId: string | null = "sub_1") => ({ id: 7, stripeSubscriptionId, subscriptionStatus });

// --- outcomeFromEvent -------------------------------------------------------

describe("subjectFromEvent — who the event is about", () => {
  it("subscription events: metadata.userId, customer, and the subscription's own id", () => {
    expect(subjectFromEvent(ev("customer.subscription.updated", sub()))).toEqual({ userId: 7, customerId: "cus_1", subscriptionId: "sub_1" });
  });
  it("checkout session: session metadata + subscription id (string or object)", () => {
    expect(subjectFromEvent(ev("checkout.session.completed", { metadata: { userId: "7" }, customer: { id: "cus_1" }, subscription: "sub_1" }))).toEqual({ userId: 7, customerId: "cus_1", subscriptionId: "sub_1" });
  });
  it("invoices: basil parent.subscription_details (metadata + subscription) and pre-basil invoice.subscription", () => {
    expect(subjectFromEvent(ev("invoice.paid", { customer: "cus_1", parent: { subscription_details: { subscription: "sub_1", metadata: { userId: "7" } } } }))).toEqual({ userId: 7, customerId: "cus_1", subscriptionId: "sub_1" });
    expect(subjectFromEvent(ev("invoice.paid", { customer: "cus_1", subscription: "sub_9" }))).toEqual({ userId: null, customerId: "cus_1", subscriptionId: "sub_9" });
  });
  it("missing / malformed metadata → userId null (route falls back to the customer id)", () => {
    expect(subjectFromEvent(ev("customer.subscription.updated", sub({ metadata: null }))).userId).toBeNull();
    expect(subjectFromEvent(ev("customer.subscription.updated", sub({ metadata: { userId: "abc" } }))).userId).toBeNull();
    expect(subjectFromEvent(ev("customer.subscription.updated", sub({ metadata: { userId: "-1" } }))).userId).toBeNull();
  });
});

describe("outcomeFromEvent — the event → outcome table", () => {
  it("checkout.session.completed with a retrieved trialing subscription → the session fields + period fields, funnel checkout_completed", () => {
    const session = { status: "complete", customer: "cus_1", subscription: "sub_1", metadata: { userId: "7" } };
    const o = outcomeFromEvent(ev("checkout.session.completed", session), { user: onFile("none", null), subscription: sub({ status: "trialing", trial_end: T }) });
    expect(o.ignored).toBeUndefined();
    expect(o.userId).toBe(7);
    expect(o.data).toEqual({
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      subscriptionStatus: "trialing",
      trialEndsAt: new Date(T * 1000),
      currentPeriodEnd: new Date(T * 1000),
      cancelAtPeriodEnd: false,
    });
    expect(o.funnel).toBe("checkout_completed");
  });
  it("checkout.session.completed without the subscription (not retrieved) → ignored; not-live subscription → ignored (replay guard)", () => {
    const session = { status: "complete", customer: "cus_1", subscription: "sub_1", metadata: { userId: "7" } };
    expect(outcomeFromEvent(ev("checkout.session.completed", session), { user: onFile("none", null) }).ignored).toMatch(/not expanded/);
    expect(outcomeFromEvent(ev("checkout.session.completed", session), { user: onFile("none", null), subscription: sub({ status: "canceled" }) }).ignored).toMatch(/not live/);
  });

  // For created/updated the snapshot in the event is IGNORED; the status comes
  // from the retrieved subscription (ctx.subscription). `upd(snapshot, retrieved)`
  // builds that pair — by default the retrieved object equals the snapshot.
  const upd = (snapshot: Record<string, unknown> = {}, retrieved: Record<string, unknown> = snapshot, prev?: Record<string, unknown>, user = onFile("active")) =>
    outcomeFromEvent(ev("customer.subscription.updated", sub(snapshot), prev), { user, subscription: sub(retrieved) });

  it("REORDER GUARD (blocking #1): deleted, then a stale updated(active) snapshot whose retrieved status is canceled → nothing written", () => {
    const o = upd({ status: "active" }, { status: "canceled" }, undefined, onFile("canceled"));
    // What's written is Stripe's CURRENT truth (canceled — a no-op against the DB), never the snapshot's "active".
    expect(o.data).toEqual(expect.objectContaining({ subscriptionStatus: "canceled", cancelAtPeriodEnd: false }));
    expect(o.data.subscriptionStatus).not.toBe("active");
    expect(o.funnel).toBeUndefined(); // DB already canceled → no transition
  });
  it("updated without the retrieved subscription → ignored (never maps from the snapshot); retrieved id ≠ event id → ignored", () => {
    expect(outcomeFromEvent(ev("customer.subscription.updated", sub()), { user: onFile("active") }).ignored).toMatch(/not retrieved/);
    expect(outcomeFromEvent(ev("customer.subscription.updated", sub()), { user: onFile("active"), subscription: sub({ id: "sub_other" }) }).ignored).toMatch(/does not match the event/);
  });
  it("customer.subscription.updated → status via the one table + cancel_at_period_end + current_period_end + trial_end (from the retrieved object)", () => {
    const o = upd({ status: "trialing", trial_end: T }, { status: "trialing", trial_end: T }, undefined, onFile("trialing"));
    expect(o.data).toEqual({
      subscriptionStatus: "trialing",
      trialEndsAt: new Date(T * 1000),
      currentPeriodEnd: new Date(T * 1000),
      cancelAtPeriodEnd: false,
      stripeSubscriptionId: "sub_1",
      stripeCustomerId: "cus_1",
    });
    expect(o.funnel).toBeUndefined();
  });
  it("updated: current_period_end is read from the subscription itself on older API versions", () => {
    const o = upd({ items: undefined, current_period_end: T + 5 });
    expect(o.data.currentPeriodEnd).toEqual(new Date((T + 5) * 1000));
  });
  it("updated with cancel_at_period_end flipping false → true: access stays (active) and funnel cancel_scheduled", () => {
    const o = upd({ cancel_at_period_end: true }, { cancel_at_period_end: true }, { cancel_at_period_end: false });
    expect(o.data.subscriptionStatus).toBe("active");
    expect(o.data.cancelAtPeriodEnd).toBe(true);
    expect(o.data.currentPeriodEnd).toEqual(new Date(T * 1000));
    expect(o.funnel).toBe("cancel_scheduled");
  });
  it("updated with cancel_at_period_end true but unchanged (not in previous_attributes) → no cancel_scheduled funnel", () => {
    const o = upd({ cancel_at_period_end: true }, { cancel_at_period_end: true }, { default_payment_method: null });
    expect(o.data.cancelAtPeriodEnd).toBe(true);
    expect(o.funnel).toBeUndefined();
  });
  it("updated with cancel_at_period_end back to false (Keep my plan) → cancelAtPeriodEnd false, no funnel", () => {
    const o = upd({ cancel_at_period_end: false }, { cancel_at_period_end: false }, { cancel_at_period_end: true });
    expect(o.data.cancelAtPeriodEnd).toBe(false);
    expect(o.funnel).toBeUndefined();
  });
  it("updated trialing → active (DB says trialing) → trial_converted; DB already active → no funnel", () => {
    expect(upd({}, {}, undefined, onFile("trialing")).funnel).toBe("trial_converted");
    expect(upd({}, {}, undefined, onFile("active")).funnel).toBeUndefined();
  });
  it("updated → past_due / canceled log payment_failed / canceled once (DB previous status differs)", () => {
    expect(upd({ status: "past_due" }).funnel).toBe("payment_failed");
    expect(upd({ status: "past_due" }, { status: "past_due" }, undefined, onFile("past_due")).funnel).toBeUndefined();
    expect(upd({ status: "canceled" }).funnel).toBe("canceled");
  });
  it("created behaves like updated (a fresh subscription is adopted by a none/canceled account)", () => {
    const fresh = sub({ id: "sub_new", status: "trialing", trial_end: T });
    const o = outcomeFromEvent(ev("customer.subscription.created", fresh), { user: onFile("none", null), subscription: fresh });
    expect(o.data.stripeSubscriptionId).toBe("sub_new");
    expect(o.data.subscriptionStatus).toBe("trialing");
    const restart = outcomeFromEvent(ev("customer.subscription.created", sub({ id: "sub_new" })), { user: onFile("canceled", "sub_old"), subscription: sub({ id: "sub_new" }) });
    expect(restart.data.stripeSubscriptionId).toBe("sub_new");
    expect(restart.data.subscriptionStatus).toBe("active");
  });
  it("created/updated for a DIFFERENT subscription than the live one on file → ignored (a stale event can't clobber the new plan)", () => {
    const old = sub({ id: "sub_old", status: "canceled" });
    expect(outcomeFromEvent(ev("customer.subscription.updated", old), { user: onFile("active", "sub_new"), subscription: old }).ignored).toMatch(/not the one on file/);
  });
  it("updated with an unmapped Stripe status (incomplete, paused) → ignored, nothing written", () => {
    for (const status of ["incomplete", "paused"]) {
      const o = upd({ status });
      expect(o.ignored).toMatch(/unmapped/);
      expect(o.data).toEqual({});
    }
  });

  it("customer.subscription.deleted → canceled, cancelAtPeriodEnd false, currentPeriodEnd null, trialEndsAt null; funnel canceled", () => {
    const o = outcomeFromEvent(ev("customer.subscription.deleted", sub({ status: "canceled", cancel_at_period_end: true })), { user: onFile("active") });
    expect(o.data).toEqual({ subscriptionStatus: "canceled", trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false });
    expect(o.funnel).toBe("canceled");
  });
  it("deleted for a subscription that is not the one on file → ignored", () => {
    expect(outcomeFromEvent(ev("customer.subscription.deleted", sub({ id: "sub_old", status: "canceled" })), { user: onFile("active", "sub_new") }).ignored).toMatch(/not the one on file/);
  });
  it("deleted with no user context still maps to canceled (route already resolved the user)", () => {
    expect(outcomeFromEvent(ev("customer.subscription.deleted", sub({ status: "canceled" }))).data.subscriptionStatus).toBe("canceled");
  });

  const invoice = (over: Record<string, unknown> = {}) => ({ customer: "cus_1", parent: { subscription_details: { subscription: "sub_1", metadata: { userId: "7" } } }, ...over });
  it("invoice.payment_failed with the matching subscription → the RETRIEVED status (past_due), funnel payment_failed on the first failure only", () => {
    const pastDue = sub({ status: "past_due" });
    const o = outcomeFromEvent(ev("invoice.payment_failed", invoice()), { user: onFile("active"), subscription: pastDue });
    expect(o.data).toEqual({ subscriptionStatus: "past_due", trialEndsAt: null, currentPeriodEnd: new Date(T * 1000), cancelAtPeriodEnd: false });
    expect(o.funnel).toBe("payment_failed");
    expect(outcomeFromEvent(ev("invoice.payment_failed", invoice()), { user: onFile("past_due"), subscription: pastDue }).funnel).toBeUndefined();
  });
  it("invoice.payment_failed: a late event whose subscription has since recovered (active) or been canceled writes THAT, never past_due from the snapshot", () => {
    expect(outcomeFromEvent(ev("invoice.payment_failed", invoice()), { user: onFile("active"), subscription: sub({ status: "active" }) }).data.subscriptionStatus).toBe("active");
    expect(outcomeFromEvent(ev("invoice.payment_failed", invoice()), { user: onFile("canceled"), subscription: sub({ status: "canceled" }) }).data.subscriptionStatus).toBe("canceled");
    expect(outcomeFromEvent(ev("invoice.payment_failed", invoice()), { user: onFile("active") }).ignored).toMatch(/not retrieved/);
  });
  it("invoice.payment_failed with a mismatched / missing subscription → ignored", () => {
    const pastDue = sub({ status: "past_due" });
    expect(outcomeFromEvent(ev("invoice.payment_failed", invoice()), { user: onFile("active", "sub_other"), subscription: pastDue }).ignored).toMatch(/does not match/);
    expect(outcomeFromEvent(ev("invoice.payment_failed", invoice()), { user: onFile("active", null), subscription: pastDue }).ignored).toMatch(/does not match/);
    expect(outcomeFromEvent(ev("invoice.payment_failed", { customer: "cus_1" }), { user: onFile("active"), subscription: pastDue }).ignored).toMatch(/no subscription/);
    expect(outcomeFromEvent(ev("invoice.payment_failed", invoice()), { user: null, subscription: pastDue }).ignored).toMatch(/does not match/); // no user at all
  });
  it("invoice.paid / invoice.payment_succeeded → active when the retrieved subscription is active; trial_converted iff DB said trialing", () => {
    for (const type of ["invoice.paid", "invoice.payment_succeeded"]) {
      const o = outcomeFromEvent(ev(type, invoice()), { user: onFile("trialing"), subscription: sub() });
      expect(o.data).toEqual({ subscriptionStatus: "active", trialEndsAt: null, currentPeriodEnd: new Date(T * 1000), cancelAtPeriodEnd: false });
      expect(o.funnel).toBe("trial_converted");
      expect(outcomeFromEvent(ev(type, invoice()), { user: onFile("active"), subscription: sub() }).funnel).toBeUndefined();
      // recovered from past_due by a successful retry → active, no trial_converted
      expect(outcomeFromEvent(ev(type, invoice()), { user: onFile("past_due"), subscription: sub() }).data.subscriptionStatus).toBe("active");
    }
  });
  it("invoice.paid for the $0 trial-start invoice (subscription still trialing) → ignored, not flipped to active", () => {
    expect(outcomeFromEvent(ev("invoice.paid", invoice()), { user: onFile("trialing"), subscription: sub({ status: "trialing", trial_end: T }) }).ignored).toMatch(/not active/);
  });
  it("invoice.paid without the retrieved subscription or with a mismatched one → ignored", () => {
    expect(outcomeFromEvent(ev("invoice.paid", invoice()), { user: onFile("trialing") }).ignored).toMatch(/not retrieved/);
    expect(outcomeFromEvent(ev("invoice.paid", invoice()), { user: onFile("trialing", "sub_other"), subscription: sub() }).ignored).toMatch(/does not match/);
  });

  it("customer.subscription.trial_will_end → no status change, funnel undefined, ignored 'handled by #121'", () => {
    const o = outcomeFromEvent(ev("customer.subscription.trial_will_end", sub({ status: "trialing" })), { user: onFile("trialing") });
    expect(o.data).toEqual({});
    expect(o.funnel).toBeUndefined();
    expect(o.ignored).toBe("trial_will_end (handled by #121)");
  });
  it("any other event type → ignored", () => {
    for (const type of ["charge.succeeded", "customer.created", "payment_intent.succeeded", "invoice.finalized"]) {
      const o = outcomeFromEvent(ev(type, { customer: "cus_1" }), { user: onFile("active") });
      expect(o.ignored).toMatch(/unhandled/);
      expect(o.data).toEqual({});
    }
  });
  it("the route retrieves the subscription for every status-bearing event except deleted (a deleted sub can't come back active)", () => {
    expect([...EVENTS_NEEDING_SUBSCRIPTION].sort()).toEqual([
      "checkout.session.completed",
      "customer.subscription.created",
      "customer.subscription.updated",
      "invoice.paid",
      "invoice.payment_failed",
      "invoice.payment_succeeded",
    ]);
    expect(EVENTS_NEEDING_SUBSCRIPTION.has("customer.subscription.deleted")).toBe(false);
  });
});

// --- the route --------------------------------------------------------------

const post = (body: string, sig: string | null = "t=1,v1=abc") =>
  webhookPOST(new Request("http://x/api/billing/webhook", { method: "POST", body, headers: sig ? { "stripe-signature": sig } : {} }));

describe("POST /api/billing/webhook", () => {
  const constructEvent = vi.fn();
  const retrieve = vi.fn();
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    vStripe.mockReturnValue({ webhooks: { constructEvent }, subscriptions: { retrieve } });
    vEvCreate.mockResolvedValue({});
    vEvDelete.mockResolvedValue({});
    vUpdate.mockResolvedValue({});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("is inert without STRIPE_WEBHOOK_SECRET: 400, Stripe never consulted, nothing recorded", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const res = await post("{}");
    expect(res.status).toBe(400);
    expect(vStripe).not.toHaveBeenCalled();
    expect(vEvCreate).not.toHaveBeenCalled();
  });
  it("missing stripe-signature header → 400 before any verification", async () => {
    const res = await post("{}", null);
    expect(res.status).toBe(400);
    expect(constructEvent).not.toHaveBeenCalled();
  });
  it("verifies the RAW body: constructEvent gets the exact text + header + secret; a bad signature → 400, body never logged", async () => {
    constructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature for payload");
    });
    const raw = '{"id":"evt_1","type":"x"}';
    const res = await post(raw, "t=1,v1=bad");
    expect(res.status).toBe(400);
    expect(constructEvent).toHaveBeenCalledWith(raw, "t=1,v1=bad", "whsec_test");
    expect(vEvCreate).not.toHaveBeenCalled();
    for (const call of errorSpy.mock.calls) expect(JSON.stringify(call)).not.toContain(raw);
  });
  it("duplicate event id (unique violation on StripeEvent) → 200 { received, duplicate } and no processing", async () => {
    constructEvent.mockReturnValue(ev("customer.subscription.updated", sub()));
    vEvCreate.mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    const res = await post("{}");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, duplicate: true });
    expect(vFind).not.toHaveBeenCalled();
    expect(vUpdate).not.toHaveBeenCalled();
  });
  it("records the event id FIRST, resolves the user by metadata.userId, RETRIEVES the subscription and applies the outcome", async () => {
    constructEvent.mockReturnValue(ev("customer.subscription.updated", sub({ cancel_at_period_end: true }), { cancel_at_period_end: false }));
    vFind.mockResolvedValue(onFile("active"));
    retrieve.mockResolvedValue(sub({ cancel_at_period_end: true }));
    const res = await post("{}");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(vEvCreate).toHaveBeenCalledWith({ data: { id: "evt_1", type: "customer.subscription.updated" } });
    expect(vEvCreate.mock.invocationCallOrder[0]).toBeLessThan(vFind.mock.invocationCallOrder[0]);
    expect(vFind).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 7 } }));
    expect(vUpdate).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { subscriptionStatus: "active", trialEndsAt: null, currentPeriodEnd: new Date(T * 1000), cancelAtPeriodEnd: true, stripeSubscriptionId: "sub_1", stripeCustomerId: "cus_1" },
    });
    expect(prisma.funnelEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 7, name: "cancel_scheduled" }) }));
    expect(retrieve).toHaveBeenCalledWith("sub_1");
  });
  it("REORDER GUARD end-to-end: a stale updated(active) after deleted retrieves 'canceled' and writes canceled, not active", async () => {
    constructEvent.mockReturnValue(ev("customer.subscription.updated", sub({ status: "active" })));
    vFind.mockResolvedValue(onFile("canceled"));
    retrieve.mockResolvedValue(sub({ status: "canceled" }));
    expect((await post("{}")).status).toBe(200);
    expect(vUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ subscriptionStatus: "canceled" }) }));
    expect(vUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ subscriptionStatus: "active" }) }));
  });
  it("deleted is applied from the event itself — no retrieval", async () => {
    constructEvent.mockReturnValue(ev("customer.subscription.deleted", sub({ status: "canceled" })));
    vFind.mockResolvedValue(onFile("active"));
    await post("{}");
    expect(retrieve).not.toHaveBeenCalled();
    expect(vUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ subscriptionStatus: "canceled" }) }));
  });
  it("falls back to the stripeCustomerId lookup when metadata has no userId", async () => {
    constructEvent.mockReturnValue(ev("customer.subscription.deleted", sub({ status: "canceled", metadata: null })));
    vFind.mockResolvedValue(onFile("active"));
    await post("{}");
    expect(vFind).toHaveBeenCalledTimes(1);
    expect(vFind).toHaveBeenCalledWith(expect.objectContaining({ where: { stripeCustomerId: "cus_1" } }));
    expect(vUpdate).toHaveBeenCalledWith({ where: { id: 7 }, data: { subscriptionStatus: "canceled", trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false } });
  });
  it("unknown user → 200 ignored, nothing written, StripeEvent row kept", async () => {
    constructEvent.mockReturnValue(ev("customer.subscription.updated", sub()));
    vFind.mockResolvedValue(null);
    const res = await post("{}");
    expect(await res.json()).toEqual({ received: true, ignored: "user not found" });
    expect(vUpdate).not.toHaveBeenCalled();
    expect(vEvDelete).not.toHaveBeenCalled();
  });
  it("checkout.session.completed retrieves the subscription by id and writes the session fields", async () => {
    constructEvent.mockReturnValue(ev("checkout.session.completed", { status: "complete", customer: "cus_1", subscription: "sub_1", metadata: { userId: "7" } }));
    vFind.mockResolvedValue(onFile("none", null));
    retrieve.mockResolvedValue(sub({ status: "trialing", trial_end: T }));
    const res = await post("{}");
    expect(await res.json()).toEqual({ received: true });
    expect(retrieve).toHaveBeenCalledWith("sub_1");
    expect(vUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ subscriptionStatus: "trialing", stripeSubscriptionId: "sub_1" }) }));
  });
  it("ignored outcomes answer 200 with the reason and write nothing", async () => {
    constructEvent.mockReturnValue(ev("customer.subscription.trial_will_end", sub({ status: "trialing" })));
    vFind.mockResolvedValue(onFile("trialing"));
    expect(await (await post("{}")).json()).toEqual({ received: true, ignored: "trial_will_end (handled by #121)" });
    expect(vUpdate).not.toHaveBeenCalled();
  });
  it("processing crash → 500 { error: processing_failed } AND the StripeEvent row is removed, so Stripe's retry reprocesses (nothing silently lost)", async () => {
    constructEvent.mockReturnValue(ev("customer.subscription.updated", sub()));
    vFind.mockResolvedValue(onFile("trialing"));
    retrieve.mockResolvedValue(sub());
    vUpdate.mockRejectedValue(new Error("db exploded"));
    const res = await post("{}");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "processing_failed" });
    expect(vEvDelete).toHaveBeenCalledWith({ where: { id: "evt_1" } });
  });
  it("a Stripe retrieval failure is a processing failure too: 500 + row removed", async () => {
    constructEvent.mockReturnValue(ev("customer.subscription.updated", sub()));
    vFind.mockResolvedValue(onFile("active"));
    retrieve.mockRejectedValue(new Error("stripe down"));
    expect((await post("{}")).status).toBe(500);
    expect(vUpdate).not.toHaveBeenCalled();
    expect(vEvDelete).toHaveBeenCalledWith({ where: { id: "evt_1" } });
  });
  it("cannot record the event at all (DB down, not a duplicate) → 503 so Stripe retries", async () => {
    constructEvent.mockReturnValue(ev("customer.subscription.updated", sub()));
    vEvCreate.mockRejectedValue(new Error("connection refused"));
    expect((await post("{}")).status).toBe(503);
    expect(vFind).not.toHaveBeenCalled();
  });
});

describe("grep guard: the webhook route's trust boundary", () => {
  const src = readFileSync("app/api/billing/webhook/route.ts", "utf8");
  it("reads the raw body (req.text()) and never req.json()", () => {
    expect(src.includes("await req.text()")).toBe(true);
    expect(src.includes("req.json(")).toBe(false);
  });
  it("verifies with constructEvent against STRIPE_WEBHOOK_SECRET and never touches the session", () => {
    expect(src.includes("webhooks.constructEvent(")).toBe(true);
    expect(src.includes("STRIPE_WEBHOOK_SECRET")).toBe(true);
    expect(src.includes('"@/lib/auth"')).toBe(false);
    expect(src.includes('"@/lib/access"')).toBe(false);
    expect(/\b(requireUser|requireActiveUser|getCurrentUser)\(/.test(src)).toBe(false);
  });
  it("is a nodejs, force-dynamic route with a 30s budget and records the event before processing", () => {
    expect(src.includes('export const runtime = "nodejs"')).toBe(true);
    expect(src.includes('export const dynamic = "force-dynamic"')).toBe(true);
    expect(src.includes("export const maxDuration = 30")).toBe(true);
    expect(src.indexOf("stripeEvent.create(")).toBeLessThan(src.indexOf("outcomeFromEvent("));
  });
  it("maps statuses only through lib/stripe (no status strings in the route)", () => {
    expect(/subscriptionStatus\s*[!=:]==?/.test(src)).toBe(false);
    expect(src.includes('"past_due"')).toBe(false);
    expect(src.includes('"canceled"')).toBe(false);
  });
});

// --- portal route (relaxed for manage/cancel) --------------------------------

describe("POST /api/billing/portal — trialing/active/past_due with a subscription may open the portal", () => {
  const portal = () => portalPOST(new Request("http://localhost:3000/api/billing/portal", { method: "POST" }));
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BILLING_ENABLED = "1";
    delete process.env.APP_URL;
    delete process.env.GOOGLE_AUTH_REDIRECT_URI;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    vPortal.mockResolvedValue("https://billing.stripe.com/session/x");
  });
  const student = (subscriptionStatus: string, stripeSubscriptionId: string | null = "sub_1") => ({
    id: 7,
    email: "s@example.com",
    fullName: "S",
    isAdmin: false,
    onboardedAt: new Date(),
    stripeCustomerId: "cus_1",
    stripeSubscriptionId,
    subscriptionStatus,
  });

  it("trialing and active → portal session with return_url /account?from=portal", async () => {
    for (const s of ["trialing", "active"]) {
      vPortal.mockClear();
      vUser.mockResolvedValue(student(s));
      const res = await portal();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ url: "https://billing.stripe.com/session/x" });
      expect(vPortal).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), "http://localhost:3000/account?from=portal");
    }
  });
  it("past_due → portal session with return_url on the past-due screen (unchanged from #119)", async () => {
    vUser.mockResolvedValue(student("past_due"));
    expect((await portal()).status).toBe(200);
    expect(vPortal).toHaveBeenCalledWith(expect.anything(), "http://localhost:3000/billing/past-due?from=portal");
  });
  it("none / canceled → 409 with next → the card step; grandfathered → 409 without next; no Stripe call", async () => {
    for (const s of ["none", "canceled"]) {
      vUser.mockResolvedValue(student(s, s === "canceled" ? "sub_old" : null));
      const res = await portal();
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "no_subscription", next: "/welcome/card" });
    }
    vUser.mockResolvedValue(student("grandfathered", null));
    const res = await portal();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "no_subscription" });
    expect(vPortal).not.toHaveBeenCalled();
  });
  it("a manageable status WITHOUT a subscription id on file → 409 (nothing to manage)", async () => {
    vUser.mockResolvedValue(student("active", null));
    expect((await portal()).status).toBe(409);
    expect(vPortal).not.toHaveBeenCalled();
  });
  it("unauthenticated → 401; billing off → 404", async () => {
    vUser.mockResolvedValue(null);
    expect((await portal()).status).toBe(401);
    vUser.mockResolvedValue(student("active"));
    process.env.BILLING_ENABLED = "";
    expect((await portal()).status).toBe(404);
  });
});

describe("portalReturnUrl targets", () => {
  it("defaults to the past-due screen; 'account' lands on /account", () => {
    expect(portalReturnUrl("https://app.navolearning.com")).toBe("https://app.navolearning.com/billing/past-due?from=portal");
    expect(portalReturnUrl("https://app.navolearning.com/", "account")).toBe("https://app.navolearning.com/account?from=portal");
  });
});

// --- /account on-return reconcile (item 4) ------------------------------------

describe("reconcileBillingFields — /account?from=portal writes only what changed", () => {
  const stored = { subscriptionStatus: "active", trialEndsAt: null, currentPeriodEnd: new Date(T * 1000), cancelAtPeriodEnd: false };
  it("cancel scheduled in the portal → cancelAtPeriodEnd true (status unchanged) is written", () => {
    expect(reconcileBillingFields(stored, sub({ cancel_at_period_end: true }))).toEqual({ subscriptionStatus: "active", trialEndsAt: null, currentPeriodEnd: new Date(T * 1000), cancelAtPeriodEnd: true });
  });
  it("kept the plan (flag back to false) / status flips are written; identical state → null (no write)", () => {
    expect(reconcileBillingFields({ ...stored, cancelAtPeriodEnd: true }, sub())?.cancelAtPeriodEnd).toBe(false);
    expect(reconcileBillingFields(stored, sub({ status: "past_due" }))?.subscriptionStatus).toBe("past_due");
    expect(reconcileBillingFields(stored, sub({ items: { data: [{ current_period_end: T + 100 }] } }))?.currentPeriodEnd).toEqual(new Date((T + 100) * 1000));
    expect(reconcileBillingFields(stored, sub())).toBeNull();
  });
  it("unknown Stripe state → null (fail open, nothing written)", () => {
    expect(reconcileBillingFields(stored, sub({ status: "incomplete" }))).toBeNull();
  });
});

describe("grep guard: /account reconciles on return from the portal like the past-due page", () => {
  const src = readFileSync("app/(app)/account/page.tsx", "utf8");
  it("retrieves the subscription, applies reconcileBillingFields, writes only when changed, inside a try (fail-open)", () => {
    expect(src.includes("subscriptions.retrieve(")).toBe(true);
    expect(src.includes("reconcileBillingFields(")).toBe(true);
    expect(src.includes("if (fields) current = await prisma.user.update(")).toBe(true);
    expect(src.indexOf("try {")).toBeLessThan(src.indexOf("subscriptions.retrieve("));
    expect(src.includes('from === "portal"')).toBe(true);
  });
});

// --- /account card state (pure) ----------------------------------------------

describe("canManageBilling / billingCardState", () => {
  it("only trialing, active and past_due have a portal-manageable subscription", () => {
    for (const s of SUBSCRIPTION_STATUSES) expect(canManageBilling(s)).toBe(s === "trialing" || s === "active" || s === "past_due");
    expect(canManageBilling("weird")).toBe(false);
  });
  it("flag off → hidden for everyone (no behavior change with BILLING_ENABLED unset)", () => {
    for (const s of SUBSCRIPTION_STATUSES) expect(billingCardState({ subscriptionStatus: s, cancelAtPeriodEnd: true }, false, false)).toBe("hidden");
  });
  it("admins and grandfathered → the quiet early-member line", () => {
    expect(billingCardState({ subscriptionStatus: "grandfathered" }, true, false)).toBe("grandfathered");
    expect(billingCardState({ subscriptionStatus: "active" }, true, true)).toBe("grandfathered");
  });
  it("cancel-at-period-end keeps the paid status but shows the 'plan ends' card", () => {
    expect(billingCardState({ subscriptionStatus: "active", cancelAtPeriodEnd: false }, true, false)).toBe("active");
    expect(billingCardState({ subscriptionStatus: "active", cancelAtPeriodEnd: true }, true, false)).toBe("cancel_scheduled");
    expect(billingCardState({ subscriptionStatus: "trialing", cancelAtPeriodEnd: true }, true, false)).toBe("cancel_scheduled");
    expect(billingCardState({ subscriptionStatus: "trialing" }, true, false)).toBe("trialing");
    // past_due / canceled / none never reach /account (requirePageAccess redirects them) → hidden
    for (const s of ["past_due", "canceled", "none", "weird"]) expect(billingCardState({ subscriptionStatus: s, cancelAtPeriodEnd: true }, true, false)).toBe("hidden");
  });
});
