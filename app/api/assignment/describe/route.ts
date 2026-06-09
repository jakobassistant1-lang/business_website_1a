import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { itemType } from "@/lib/itemType";
import { generateAssignmentDescription } from "@/lib/briefing";

export const dynamic = "force-dynamic";

// In-process cache so re-opening an item doesn't re-call Gemini.
const CACHE = new Map<string, { text: string; at: number }>();
const TTL_MS = 60 * 60_000;
const MAX = 300;

// GET /api/assignment/describe?id=<canvasId> — a one-sentence Gemini description
// of the assignment. Prefers the stored AI summary; falls back to generating one.
// Fails open: returns text=null whenever the AI is unavailable.
export async function GET(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ text: null });

  const a = await prisma.assignment.findFirst({
    where: { userId: user.id, canvasId: id },
    include: { course: true },
  });
  if (!a) return NextResponse.json({ text: null });

  // The analysis pipeline already writes a one-line summary — prefer it.
  if (a.aiSummary) return NextResponse.json({ text: a.aiSummary, source: "analysis" });

  const key = `${user.id}:${id}:${a.name}`;
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json({ text: hit.text, cached: true });

  const result = await generateAssignmentDescription({
    name: a.name,
    courseName: a.course.name,
    type: itemType(a.submissionType, a.name),
    points: a.pointsPossible,
    dueLabel: a.dueAt ? a.dueAt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : null,
  });

  if (result.ok) {
    if (CACHE.size >= MAX) {
      const oldest = CACHE.keys().next().value;
      if (oldest) CACHE.delete(oldest);
    }
    CACHE.set(key, { text: result.text, at: Date.now() });
  }
  return NextResponse.json({ text: result.ok ? result.text : null });
}
