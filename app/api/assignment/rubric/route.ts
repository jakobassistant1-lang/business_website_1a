import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/crypto";
import { fetchAssignmentRubric, type CanvasRubricCriterion } from "@/lib/canvas";

export const dynamic = "force-dynamic";

// GET /api/assignment/rubric?id=<canvasId> — { rubric: CanvasRubricCriterion[] | null }.
// A live Canvas call, fetched CLIENT-side so it never blocks the assignment page's
// SSR (the call can take up to the 10s Canvas timeout). Fails open (null). Short
// in-process cache so revisits don't re-hit Canvas.
const CACHE = new Map<string, { rubric: CanvasRubricCriterion[] | null; at: number }>();
const TTL_MS = 30 * 60_000;
const MAX = 300;

export async function GET(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const canvasId = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isFinite(canvasId) || canvasId <= 0) return NextResponse.json({ rubric: null });

  const key = `${user.id}:${canvasId}`;
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json({ rubric: hit.rubric });

  const a = await prisma.assignment.findUnique({ where: { userId_canvasId: { userId: user.id, canvasId } }, select: { courseCanvasId: true } });
  const cred = a ? await prisma.canvasCredential.findUnique({ where: { userId: user.id } }) : null;
  const rubric = a && cred ? await fetchAssignmentRubric(cred.host, decryptSecret(cred.token), a.courseCanvasId, canvasId) : null;

  if (CACHE.size >= MAX) {
    const oldest = CACHE.keys().next().value;
    if (oldest) CACHE.delete(oldest);
  }
  CACHE.set(key, { rubric, at: Date.now() });
  return NextResponse.json({ rubric });
}
