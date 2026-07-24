import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin";
import { billingEnabled, needsCheckout } from "@/lib/subscription";
import { createTrialCheckoutSession } from "@/lib/stripe";
import { logEvent } from "@/lib/funnel";

export const dynamic = "force-dynamic";

// POST — create the Embedded Checkout session for the card step (#118).
// Flow: signup → demo → /welcome/card (this) → app. Guards: billing must be
// enabled; admins and already-subscribed/grandfathered accounts can't double-pay.
export async function POST() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!billingEnabled()) return NextResponse.json({ error: "billing_disabled" }, { status: 404 });
  if (isAdminUser(user) || !needsCheckout(user.subscriptionStatus)) {
    return NextResponse.json({ error: "not_needed", next: "/dashboard" }, { status: 409 });
  }
  try {
    const { clientSecret, sessionId } = await createTrialCheckoutSession(user);
    void logEvent("checkout_started", user.id, { sessionId });
    return NextResponse.json({ clientSecret, sessionId });
  } catch (e) {
    console.error("checkout-session failed", e);
    return NextResponse.json({ error: "Couldn't start checkout. Try again in a moment." }, { status: 500 });
  }
}
