import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { stripe, subjectFromEvent, outcomeFromEvent, EVENTS_NEEDING_SUBSCRIPTION, type StripeSubscriptionShape } from "@/lib/stripe";
import { logEvent } from "@/lib/funnel";
import { sendTrialEndingEmail } from "@/lib/trialEndingEmail";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

// POST — Stripe webhooks (#109): the ongoing source of truth for every billing
// status change (trial → active, payment failed, cancel scheduled, canceled).
//
// No session cookie here — Stripe is the caller — so this route deliberately
// uses NO requireUser/requireActiveUser. Trust comes from the signature over the
// RAW body (req.text(); parsing first would break verification). Without
// STRIPE_WEBHOOK_SECRET the route is inert: every call is a 400 and nothing is
// read or written.
//
// Idempotent by event id: the StripeEvent insert happens FIRST; a duplicate id
// (Stripe retries) is acknowledged and skipped. 200 = verified and applied,
// duplicate, or deliberately ignored. A processing failure answers 500 AND
// removes the StripeEvent row, so Stripe's retry (or a dashboard resend) can
// reprocess it — nothing is silently lost. Statuses are mapped from the
// RETRIEVED subscription, never an event snapshot (events arrive out of order).
// Mapping lives in lib/stripe (outcomeFromEvent), pure.
//
// #121: `customer.subscription.trial_will_end` writes nothing and instead asks
// for the trial-ending email (`outcome.email`). The send is AWAITED (it never
// throws, so a mail outage still can't 500 the webhook): the StripeEvent row is
// already committed by then, so a `void` send that the serverless runtime
// freezes after the response would be lost with no retry — a charge with no
// notice. The id row is what makes it one send per delivered event, and Stripe
// fires the event once per subscription.
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers.get("stripe-signature");
  if (!secret || !sig) {
    console.error("stripe webhook rejected:", secret ? "missing stripe-signature header" : "STRIPE_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "bad_signature" }, { status: 400 });
  }

  const raw = await req.text();
  let event: ReturnType<ReturnType<typeof stripe>["webhooks"]["constructEvent"]>;
  try {
    event = stripe().webhooks.constructEvent(raw, sig, secret);
  } catch (e) {
    console.error("stripe webhook signature failed:", e instanceof Error ? e.message : "unknown error");
    return NextResponse.json({ error: "bad_signature" }, { status: 400 });
  }

  // Idempotency gate — before any other work.
  try {
    await prisma.stripeEvent.create({ data: { id: event.id, type: event.type } });
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") return NextResponse.json({ received: true, duplicate: true });
    // Could not even record the event (DB unavailable): nothing was written, so
    // let Stripe retry later.
    console.error("stripe webhook could not record event:", e instanceof Error ? e.message : "unknown error");
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  try {
    const subject = subjectFromEvent(event);
    const user =
      (subject.userId ? await prisma.user.findUnique({ where: { id: subject.userId }, select: USER_SELECT }) : null) ??
      (subject.customerId ? await prisma.user.findUnique({ where: { stripeCustomerId: subject.customerId }, select: USER_SELECT }) : null);
    if (!user) {
      console.error("stripe webhook: no user for event", event.type);
      return NextResponse.json({ received: true, ignored: "user not found" });
    }

    let subscription: StripeSubscriptionShape | null = null;
    if (EVENTS_NEEDING_SUBSCRIPTION.has(event.type) && subject.subscriptionId) {
      subscription = (await stripe().subscriptions.retrieve(subject.subscriptionId)) as unknown as StripeSubscriptionShape;
    }

    const outcome = outcomeFromEvent(event, { user, subscription });
    if (outcome.ignored) return NextResponse.json({ received: true, ignored: outcome.ignored });

    if (Object.keys(outcome.data).length > 0) {
      await prisma.user.update({ where: { id: user.id }, data: outcome.data });
    }
    // Awaited, never `void`: the serverless runtime may freeze the function the
    // moment the response is returned, and the StripeEvent row is already
    // committed, so a detached insert is simply lost (trial_converted never
    // landed in the rehearsal). logEvent never throws — one insert, no risk.
    if (outcome.funnel) await logEvent(outcome.funnel, user.id, { eventId: event.id, type: event.type, source: "webhook" });
    if (outcome.email === "trial_ending") {
      await sendTrialEndingEmail(user, event.data.object as { trial_end?: number | null }, new URL(req.url).origin, {
        eventId: event.id,
        type: event.type,
        source: "webhook",
      });
      return NextResponse.json({ received: true, email: outcome.email });
    }
    return NextResponse.json({ received: true });
  } catch (e) {
    console.error("stripe webhook processing failed:", event.type, e instanceof Error ? e.message : "unknown error");
    await prisma.stripeEvent.delete({ where: { id: event.id } }).catch(() => {});
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}

// email/fullName/trialEndsAt feed the trial-ending email; cancelAtPeriodEnd lets
// outcomeFromEvent skip it for a student who already canceled.
const USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  stripeSubscriptionId: true,
  subscriptionStatus: true,
  cancelAtPeriodEnd: true,
  trialEndsAt: true,
} as const;
