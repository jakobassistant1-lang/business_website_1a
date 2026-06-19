import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateAssignmentPlan } from "@/lib/briefing";
import { itemType } from "@/lib/itemType";

export const dynamic = "force-dynamic";

// GET /api/assignment/approach?id=<canvasId> — { approach, steps }. Fails open
// (null/[]). Best-effort in-process cache so a page revisit doesn't re-hit Gemini.
const CACHE = new Map<string, { approach: string | null; steps: string[]; at: number }>();
const TTL_MS = 60 * 60_000;
const MAX = 300;

export async function GET(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const canvasId = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isFinite(canvasId)) return NextResponse.json({ approach: null, steps: [] });

  const a = await prisma.assignment.findUnique({ where: { userId_canvasId: { userId: user.id, canvasId } }, include: { course: true } });
  if (!a) return NextResponse.json({ approach: null, steps: [] });

  const key = `${user.id}:${canvasId}`;
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json({ approach: hit.approach, steps: hit.steps });

  const plan = await generateAssignmentPlan({
    name: a.name,
    courseName: a.course.name,
    type: itemType(a.submissionType, a.name),
    points: a.pointsPossible ?? null,
    dueLabel: a.dueAt ? a.dueAt.toISOString().slice(0, 10) : null,
  });

  if (plan.source === "gemini") {
    if (CACHE.size >= MAX) {
      const oldest = CACHE.keys().next().value;
      if (oldest) CACHE.delete(oldest);
    }
    CACHE.set(key, { approach: plan.approach, steps: plan.steps, at: Date.now() });
  }
  return NextResponse.json({ approach: plan.approach, steps: plan.steps });
}
