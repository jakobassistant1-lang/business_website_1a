import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// PATCH { courseCanvasId, excluded } — exclude a course from planning (#60) or
// include it again. Sets Course.excludedAt; the assignment chokepoint filters
// (lib/calendarData, lib/plan) drop or restore its work everywhere at once.
// Canvas sync never writes this column, so a sync can't resurrect a gym class.
export async function PATCH(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id = Number(body.courseCanvasId);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  if (typeof body.excluded !== "boolean") return NextResponse.json({ error: "bad_excluded" }, { status: 400 });

  const res = await prisma.course.updateMany({
    where: { userId: user.id, canvasId: id },
    data: { excludedAt: body.excluded ? new Date() : null },
  });
  if (res.count === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
