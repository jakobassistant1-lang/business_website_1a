import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// PATCH { id, done } — the student's manual checkoff. done:true stamps
// manualDoneAt, done:false clears it. Feeds the ONE done rule
// (lib/assignmentStatus.isAssignmentDone), so checking an item moves it to
// Completed on every surface at once and drops it from the ranking and the
// week plan on the next refresh. Canvas sync never touches this column.
export async function PATCH(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  if (typeof body.done !== "boolean") return NextResponse.json({ error: "bad_done" }, { status: 400 });

  // Scoped to this user (canvasId is unique per user, not globally).
  const res = await prisma.assignment.updateMany({
    where: { userId: user.id, canvasId: id },
    data: { manualDoneAt: body.done ? new Date() : null },
  });
  if (res.count === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
