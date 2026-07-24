import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin";
import { billingEnabled, postDemoDestination } from "@/lib/subscription";
import { logEvent } from "@/lib/funnel";

export const dynamic = "force-dynamic";

// POST — mark the current user's first-run demo as finished (or skipped). Called
// by the demo's End/Skip actions so it never auto-opens again. Idempotent: a
// no-op once onboardedAt is set, so replaying the demo later never clears it.
// Returns `next`: with billing on, the flow is signup → demo → CARD → app, so a
// new student's next stop is /welcome/card, not the dashboard (#118).
export async function POST() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!user.onboardedAt) {
    await prisma.user.update({ where: { id: user.id }, data: { onboardedAt: new Date() } });
    void logEvent("demo_completed", user.id);
  }
  return NextResponse.json({ ok: true, next: postDemoDestination(user.subscriptionStatus, billingEnabled(), isAdminUser(user)) });
}
