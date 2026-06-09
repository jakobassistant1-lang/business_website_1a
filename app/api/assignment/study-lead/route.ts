import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// PATCH { id, days } — set (or clear with null) the per-assignment number of days
// ahead to start studying for this exam/quiz. null reverts to the User default.
export async function PATCH(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "bad_id" }, { status: 400 });

  let days: number | null;
  if (body.days === null || body.days === "" || body.days === undefined) {
    days = null;
  } else {
    const d = Number(body.days);
    if (!(Number.isInteger(d) && d >= 1 && d <= 14)) {
      return NextResponse.json({ error: "Enter a whole number of days (1–14)." }, { status: 400 });
    }
    days = d;
  }

  // Scoped to this user (canvasId is unique per user, not globally).
  const res = await prisma.assignment.updateMany({
    where: { userId: user.id, canvasId: id },
    data: { studyLeadDays: days },
  });
  if (res.count === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
