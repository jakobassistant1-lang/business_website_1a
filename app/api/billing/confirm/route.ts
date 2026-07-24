import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { billingEnabled } from "@/lib/subscription";
import { stripe, sessionBelongsTo, subscriptionFieldsFromSession } from "@/lib/stripe";
import { logEvent } from "@/lib/funnel";

export const dynamic = "force-dynamic";

// GET ?session_id — after the embedded checkout completes (or on card-page load
// to reconcile a paid-then-closed-tab), verify with Stripe and write the billing
// fields. Ownership-checked: a session id from another user is refused. Until
// #109 (webhooks) lands this is the writer; webhooks then become the ongoing
// source of truth for every later status change.
export async function GET(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!billingEnabled()) return NextResponse.json({ error: "billing_disabled" }, { status: 404 });

  const sessionId = new URL(req.url).searchParams.get("session_id");
  if (!sessionId) return NextResponse.json({ error: "bad_session" }, { status: 400 });

  try {
    const session = await stripe().checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });
    if (!sessionBelongsTo(session as { metadata?: Record<string, string> | null }, user.id)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const fields = subscriptionFieldsFromSession(session as Parameters<typeof subscriptionFieldsFromSession>[0]);
    if (!fields) return NextResponse.json({ complete: false });

    await prisma.user.update({ where: { id: user.id }, data: fields });
    void logEvent("checkout_completed", user.id, { sessionId, status: fields.subscriptionStatus });
    return NextResponse.json({ complete: true, next: "/dashboard?welcome=1" });
  } catch (e) {
    console.error("billing confirm failed", e);
    return NextResponse.json({ error: "Couldn't confirm your subscription. Refresh to retry." }, { status: 500 });
  }
}
