import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST — mark the current user's first-run demo as finished (or skipped). Called
// by the demo's End/Skip actions so it never auto-opens again. Idempotent: a
// no-op once onboardedAt is set, so replaying the demo later never clears it.
export async function POST() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!user.onboardedAt) {
    await prisma.user.update({ where: { id: user.id }, data: { onboardedAt: new Date() } });
  }
  return NextResponse.json({ ok: true });
}
