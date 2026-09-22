import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin";
import { appOrigin } from "@/lib/appUrl";
import { accessDecision, billingEnabled, needsCheckout } from "@/lib/subscription";
import { createPortalSession, portalReturnUrl } from "@/lib/stripe";

export const dynamic = "force-dynamic";

// POST — open Stripe's Billing Portal so a past-due student can update the card
// on file (#119). Deliberately requireUser, NOT requireActiveUser: the whole
// point is that a blocked account must be able to reach this. Only a past-due
// account WITH a subscription on file has anything to fix here. Anyone else gets
// a 409 (no Stripe customer is created): with `next` → the card step when that's
// the right answer (needsCheckout), otherwise no `next` — the button shows a
// calm "email support" line (e.g. a past_due row with no subscription id). Returns { url }.
export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!billingEnabled()) return NextResponse.json({ error: "billing_disabled" }, { status: 404 });
  if (accessDecision(user, billingEnabled(), isAdminUser(user)) !== "past_due" || !user.stripeSubscriptionId) {
    return NextResponse.json(
      needsCheckout(user.subscriptionStatus) ? { error: "no_subscription", next: "/welcome/card" } : { error: "no_subscription" },
      { status: 409 },
    );
  }
  try {
    const url = await createPortalSession(user, portalReturnUrl(appOrigin(new URL(req.url).origin)));
    return NextResponse.json({ url });
  } catch (e) {
    console.error("billing portal failed", e instanceof Error ? e.message : "unknown error");
    return NextResponse.json({ error: "Couldn't open the payment page. Try again in a moment." }, { status: 500 });
  }
}
