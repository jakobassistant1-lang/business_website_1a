import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { requireActiveUser } from "@/lib/access";
import { loadCalendarData, upcomingAssessments } from "@/lib/calendarData";
import { studentZone, todayInZone } from "@/lib/studentZone";
import { generateStudyHub, VOICE_VERSION, type PromptItem } from "@/lib/briefing";

export const dynamic = "force-dynamic";

// Best-effort per-warm-instance cache so a study-page load doesn't re-hit Gemini.
// Only real Gemini results are cached; a fail-open null is left uncached so the
// next visit retries through a transient outage. Mirrors /api/dashboard-summary.
const CACHE = new Map<string, { summary: string | null; at: number }>();
const TTL_MS = 30 * 60_000;
const MAX = 200;

// GET /api/study-summary — { summary } for the Study hub header. `summary` is null
// when the AI is unavailable or there's nothing upcoming (the page renders fine
// without it — fail-open, same as the dashboard summary). Dates are read in the
// student's Canvas zone (lib/studentZone), server-side; a client `tz` is ignored.
export async function GET() {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const data = await loadCalendarData(user.id);
  const upcoming = upcomingAssessments(data); // the app's importance order (CalendarData.ranked)
  if (upcoming.length === 0) return NextResponse.json({ summary: null }); // nothing to orient → skip the call

  const zone = studentZone(user);
  const now = new Date();
  const top: PromptItem[] = upcoming.slice(0, 5).map((it) => ({
    name: it.name,
    courseName: it.courseName,
    type: it.type,
    dueAt: it.dueAt,
    points: it.pointsPossible,
  }));

  // Signature covers the prompt-relevant content (names + due instants, the zone
  // and today) plus the prompt version, so a new test, a date shift or a prompt
  // change regenerates instead of serving a stale orientation.
  const sig = JSON.stringify({
    ver: VOICE_VERSION,
    u: user.id,
    z: zone,
    d: todayInZone(zone, now),
    c: upcoming.length,
    t: top.map((t) => `${t.name}:${t.dueAt ?? ""}:${t.points ?? ""}`),
  });
  const key = createHash("sha1").update(sig).digest("hex");
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json({ summary: hit.summary });

  const res = await generateStudyHub({ count: upcoming.length, top, timeZone: zone, now });
  const summary = res.ok ? res.text : null;
  if (res.ok) {
    if (CACHE.size >= MAX) {
      const oldest = CACHE.keys().next().value;
      if (oldest) CACHE.delete(oldest);
    }
    CACHE.set(key, { summary, at: Date.now() });
  }
  return NextResponse.json({ summary });
}
