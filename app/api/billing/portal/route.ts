import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin";
import { appOrigin } from "@/lib/appUrl";
import { accessDecision, billingEnabled, canManageBilling, needsCheckout } from "@/lib/subscription";
import { createPortalSession, portalReturnUrl } from "@/lib/stripe";

export const dynamic = "force-dynamic";

// POST — open Stripe's Billing Portal (#119 update card; #109 manage/cancel/keep).
// Deliberately requireUser, NOT requireActiveUser: a blocked (past-due) account
// must be able to reach this. Any account with a live subscription on file
// (trialing / active / past_due — canManageBilling) may open it; Stripe's
// portal handles cancel-at-period-end and "keep my plan". Anyone else gets a
// 409 (no Stripe customer is created): with `next` → the card step when that's
// the right answer (needsCheckout), otherwise no `next` — the button shows a
// calm "email support" line. The return_url depends on where they came from:
// past-due → the past-due screen (reconciles), everyone else → /account. Returns { url }.
export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!billingEnabled()) return NextResponse.json({ error: "billing_disabled" }, { status: 404 });
  if (!canManageBilling(user.subscriptionStatus) || !user.stripeSubscriptionId) {
    return NextResponse.json(
      needsCheckout(user.subscriptionStatus) ? { error: "no_subscription", next: "/welcome/card" } : { error: "no_subscription" },
      { status: 409 },
    );
  }
  const target = accessDecision(user, billingEnabled(), isAdminUser(user)) === "past_due" ? "past_due" : "account";
  try {
    const url = await createPortalSession(user, portalReturnUrl(appOrigin(new URL(req.url).origin), target));
    return NextResponse.json({ url });
  } catch (e) {
    console.error("billing portal failed", e instanceof Error ? e.message : "unknown error");
    return NextResponse.json({ error: "Couldn't open the payment page. Try again in a moment." }, { status: 500 });
  }
}
