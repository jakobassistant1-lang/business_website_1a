import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { requireUser } from "@/lib/auth";
import { loadCalendarData, upcomingAssessments } from "@/lib/calendarData";
import { daysBetween } from "@/lib/calendarDates";
import { generateStudyHub, type StudyHubItem } from "@/lib/briefing";

export const dynamic = "force-dynamic";

// Best-effort per-warm-instance cache so a study-page load doesn't re-hit Gemini.
// Only real Gemini results are cached; a fail-open null is left uncached so the
// next visit retries through a transient outage. Mirrors /api/dashboard-summary.
const CACHE = new Map<string, { summary: string | null; at: number }>();
const TTL_MS = 30 * 60_000;
const MAX = 200;

function relativeDue(iso: string): string {
  const d = daysBetween(new Date(), new Date(iso));
  return d < 0 ? "overdue" : d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`;
}

// GET /api/study-summary — { summary } for the Study hub header. `summary` is null
// when the AI is unavailable or there's nothing upcoming (the page renders fine
// without it — fail-open, same as the dashboard summary).
export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const data = await loadCalendarData(user.id);
  const upcoming = upcomingAssessments(data);
  if (upcoming.length === 0) return NextResponse.json({ summary: null }); // nothing to orient → skip the call

  const firstName = user.fullName.trim().split(/\s+/)[0] ?? "";
  const top: StudyHubItem[] = upcoming.slice(0, 5).map((it) => ({
    name: it.name,
    courseName: it.courseName,
    type: it.type,
    dueLabel: it.dueAt ? relativeDue(it.dueAt) : "no date",
  }));

  // Signature covers the prompt-relevant content (names + due labels) so a new
  // test or a date shift regenerates instead of serving a stale orientation.
  const sig = JSON.stringify({ u: user.id, n: firstName, c: upcoming.length, t: top.map((t) => `${t.name}:${t.dueLabel}`) });
  const key = createHash("sha1").update(sig).digest("hex");
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json({ summary: hit.summary });

  const res = await generateStudyHub({ firstName, count: upcoming.length, top });
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
