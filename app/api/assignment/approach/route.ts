import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { requireActiveUser } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { generateAssignmentPlan, VOICE_VERSION } from "@/lib/briefing";
import { itemType } from "@/lib/itemType";
import { studentZone, todayInZone } from "@/lib/studentZone";
import { sanitizeBrief } from "@/lib/sanitizeBrief";
import { stripHtml } from "@/lib/study";

export const dynamic = "force-dynamic";

// GET /api/assignment/approach?id=<canvasId> — { approach, steps }.
// Fails open (null/[]). Best-effort in-process cache so a page revisit doesn't
// re-hit Gemini. The prompt gets the Canvas instructions as plain text and the
// due/today days in the student's Canvas zone (lib/studentZone, server-side). An
// item that isn't open yet (Canvas unlock date in the future) gets no AI call.
const BRIEF_CHARS = 4000;
const CACHE = new Map<string, { approach: string | null; steps: string[]; at: number }>();
const TTL_MS = 60 * 60_000;
const MAX = 300;

export async function GET(req: Request) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const canvasId = Number(params.get("id"));
  if (!Number.isFinite(canvasId) || canvasId <= 0) return NextResponse.json({ approach: null, steps: [] });

  const a = await prisma.assignment.findUnique({ where: { userId_canvasId: { userId: user.id, canvasId } }, include: { course: true } });
  if (!a) return NextResponse.json({ approach: null, steps: [] });

  const now = new Date();
  // Not open yet: the page shows "Not open yet. Opens …" instead of a plan.
  if (a.unlockAt && a.unlockAt.getTime() > now.getTime()) return NextResponse.json({ approach: null, steps: [], locked: true });

  // The brief as plain text: sanitized first (drops scripts and Canvas's hidden
  // screen-reader text), then tags stripped by the study engine's helper. "" when
  // Canvas has no description — the prompt then works from the title, course,
  // type, points and due date, and says nothing about the missing instructions.
  const brief = a.description ? stripHtml(sanitizeBrief(a.description), BRIEF_CHARS) : "";
  const zone = studentZone(user);
  const todayYmd = todayInZone(zone, now);

  // Key includes the prompt version and a hash of the prompt-relevant fields, so a
  // rename / points / due / brief / zone / day / prompt change busts the cache
  // instead of serving a stale plan.
  const sig = createHash("sha1")
    .update([VOICE_VERSION, a.name, a.course.name, a.pointsPossible ?? "", a.dueAt?.toISOString() ?? "", a.submissionType ?? "", zone, todayYmd, brief].join("\u0000"))
    .digest("hex");
  const key = `${user.id}:${canvasId}:${sig}`;
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json({ approach: hit.approach, steps: hit.steps });

  const plan = await generateAssignmentPlan({
    name: a.name,
    courseName: a.course.name,
    type: itemType(a.submissionType, a.name),
    points: a.pointsPossible ?? null,
    dueAt: a.dueAt,
    brief,
    timeZone: zone,
    now,
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
