import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { isBillingConfigured, createBillingPortalSession } from "@/lib/billing";

// POST — open the Stripe Billing Portal (manage or cancel) for the signed-in
// user and return its URL. When billing is OFF the route does not exist (404).
export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isBillingConfigured()) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const url = await createBillingPortalSession(user, new URL(req.url).origin);
    return NextResponse.json({ url });
  } catch {
    return NextResponse.json({ error: "Could not open the billing portal. Please try again." }, { status: 502 });
  }
}
