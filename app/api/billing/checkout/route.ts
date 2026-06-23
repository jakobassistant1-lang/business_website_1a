import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { isBillingConfigured, createCheckoutSession } from "@/lib/billing";

// POST — start a Stripe Checkout session for the signed-in user and return its
// hosted URL for the client to redirect to. When billing is OFF the route does
// not exist (404), so the live app is unchanged.
export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isBillingConfigured()) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const url = await createCheckoutSession(user, new URL(req.url).origin);
    return NextResponse.json({ url });
  } catch {
    return NextResponse.json({ error: "Could not start checkout. Please try again." }, { status: 502 });
  }
}
