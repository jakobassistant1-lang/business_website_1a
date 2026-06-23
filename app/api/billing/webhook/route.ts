import { NextResponse } from "next/server";
import { isBillingConfigured, verifyStripeWebhook, applySubscriptionEvent } from "@/lib/billing";

// Stripe webhook receiver. NO auth — Stripe calls this server-to-server; the
// signature IS the authentication. When billing is OFF the route does not exist
// (404). The raw request body is read with req.text() (NOT req.json), because the
// signature is computed over the exact bytes Stripe sent — parsing first would
// change them and break verification.
//
// Idempotent: every handled event funnels into applySubscriptionEvent, which only
// mirrors fields onto the User, so Stripe's at-least-once redelivery is safe.
export async function POST(req: Request) {
  if (!isBillingConfigured()) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rawBody = await req.text();
  const sig = req.headers.get("stripe-signature") ?? "";
  if (!verifyStripeWebhook(rawBody, sig)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  let event: { type?: unknown; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const type = typeof event.type === "string" ? event.type : "";
  const object = event.data?.object ?? {};

  try {
    switch (type) {
      // These events carry the Subscription object directly — pass it through.
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.trial_will_end":
        await applySubscriptionEvent(object);
        break;

      // Invoice events carry an Invoice, not a Subscription. Map the minimal bits
      // applySubscriptionEvent reads: the customer, the subscription id, and a
      // status derived from the outcome. We deliberately omit the period/trial
      // dates here so a payment event never clobbers good values with nulls
      // (applySubscriptionEvent keeps the existing value when a field is absent).
      case "invoice.paid":
        await applySubscriptionEvent({
          customer: object.customer,
          id: object.subscription,
          status: "active",
        });
        break;
      case "invoice.payment_failed":
        await applySubscriptionEvent({
          customer: object.customer,
          id: object.subscription,
          status: "past_due",
        });
        break;

      // Any other event type — acknowledge so Stripe stops retrying.
      default:
        break;
    }
  } catch (err) {
    // A storage failure is OUR fault — return 500 so Stripe retries later.
    console.error(`[billing] webhook handler failed for ${type}`, err);
    return NextResponse.json({ error: "handler error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
