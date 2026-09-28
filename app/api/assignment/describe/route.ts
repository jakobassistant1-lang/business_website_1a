import { NextResponse } from "next/server";
import { formatDue } from "@/lib/dueLabel";
import { ymdInZone } from "@/lib/calendarDates";
import { safeTimeZone } from "@/lib/briefing";
import { requireActiveUser } from "@/lib/access";
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
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const id = Number(params.get("id"));
  const tz = safeTimeZone(params.get("tz")); // UTC when the client doesn't send its zone
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
    // Server zone is UTC on Vercel — read the day in the student's zone (sent as `tz`, validated) like the other AI routes.
    dueLabel: a.dueAt ? formatDue(a.dueAt.toISOString(), "short", { todayYmd: ymdInZone(new Date(), tz), timeZone: tz }) : null,
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
