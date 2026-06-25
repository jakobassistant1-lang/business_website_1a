import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// PATCH { id, hours } — set (or clear with null) the per-assignment MANUAL override
// of the AI effort estimate. null reverts to the AI estimate. The override feeds the
// displayed "~Nh" tag AND the scheduler (lib/calendarData.effortOf), so changing it
// re-plans the work, not just the label.
export async function PATCH(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "bad_id" }, { status: 400 });

  let hours: number | null;
  if (body.hours === null || body.hours === "" || body.hours === undefined) {
    hours = null; // reset → use the AI estimate
  } else {
    const h = Number(body.hours);
    if (!(Number.isFinite(h) && h >= 0.25 && h <= 20)) {
      return NextResponse.json({ error: "Enter a time between 15 minutes and 20 hours." }, { status: 400 });
    }
    hours = Math.round(h * 100) / 100;
  }

  // Scoped to this user (canvasId is unique per user, not globally).
  const res = await prisma.assignment.updateMany({
    where: { userId: user.id, canvasId: id },
    data: { effortOverrideHours: hours },
  });
  if (res.count === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
