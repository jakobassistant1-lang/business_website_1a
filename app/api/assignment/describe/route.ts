import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { studentZone, todayInZone } from "@/lib/studentZone";
import { requireActiveUser } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { itemType } from "@/lib/itemType";
import { generateAssignmentDescription, VOICE_VERSION } from "@/lib/briefing";
import { sanitizeBrief } from "@/lib/sanitizeBrief";
import { stripHtml } from "@/lib/study";

export const dynamic = "force-dynamic";

// In-process cache so re-opening an item doesn't re-call Gemini.
const CACHE = new Map<string, { text: string; at: number }>();
const TTL_MS = 60 * 60_000;
const MAX = 300;

// GET /api/assignment/describe?id=<canvasId> — a one-sentence Gemini description
// of the assignment. Prefers the stored AI summary; falls back to generating one.
// Fails open: returns text=null whenever the AI is unavailable. Dates are read in
// the student's Canvas zone (lib/studentZone), server-side.
export async function GET(req: Request) {
  const user = await requireActiveUser();
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

  const zone = studentZone(user);
  const now = new Date();
  // Same plain-text instructions the approach route sends (sanitized, then stripped).
  const brief = a.description ? stripHtml(sanitizeBrief(a.description), 4000) : "";
  const sig = createHash("sha1")
    .update([VOICE_VERSION, a.name, a.course.name, a.pointsPossible ?? "", a.dueAt?.toISOString() ?? "", a.submissionType ?? "", zone, todayInZone(zone, now), brief].join("\u0000"))
    .digest("hex");
  const key = `${user.id}:${id}:${sig}`;
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json({ text: hit.text, cached: true });

  const result = await generateAssignmentDescription({
    name: a.name,
    courseName: a.course.name,
    type: itemType(a.submissionType, a.name),
    points: a.pointsPossible,
    dueAt: a.dueAt,
    brief,
    timeZone: zone,
    now,
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
