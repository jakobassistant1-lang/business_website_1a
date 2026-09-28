import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { requireActiveUser } from "@/lib/access";
import { loadCalendarData, upcomingAssessments } from "@/lib/calendarData";
import { ymdInZone } from "@/lib/calendarDates";
import { dayCount, generateStudyHub, inDays, safeTimeZone, type StudyHubItem } from "@/lib/briefing";

export const dynamic = "force-dynamic";

// Best-effort per-warm-instance cache so a study-page load doesn't re-hit Gemini.
// Only real Gemini results are cached; a fail-open null is left uncached so the
// next visit retries through a transient outage. Mirrors /api/dashboard-summary.
const CACHE = new Map<string, { summary: string | null; at: number }>();
const TTL_MS = 30 * 60_000;
const MAX = 200;

/** Exact day count from `todayYmd` to the due day, both read in the viewer's zone
 *  (#140: UTC days put an 11:59 PM ET quiz on the next day). */
function relativeDue(dueYmd: string, todayYmd: string): string {
  const d = dayCount(dueYmd, todayYmd);
  return d < 0 ? "overdue" : inDays(d);
}

// GET /api/study-summary?tz=<IANA zone> — { summary } for the Study hub header. `summary` is null
// when the AI is unavailable or there's nothing upcoming (the page renders fine
// without it — fail-open, same as the dashboard summary).
export async function GET(req: Request) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const data = await loadCalendarData(user.id);
  const upcoming = upcomingAssessments(data);
  if (upcoming.length === 0) return NextResponse.json({ summary: null }); // nothing to orient → skip the call

  const firstName = user.fullName.trim().split(/\s+/)[0] ?? "";
  const tz = safeTimeZone(new URL(req.url).searchParams.get("tz"));
  const todayYmd = ymdInZone(new Date(), tz);
  const top: StudyHubItem[] = upcoming.slice(0, 5).map((it) => {
    const dueYmd = it.dueAt ? ymdInZone(it.dueAt, tz) : null;
    return {
      name: it.name,
      courseName: it.courseName,
      type: it.type,
      dueLabel: dueYmd ? relativeDue(dueYmd, todayYmd) : "no date",
      ...(dueYmd ? { dueYmd } : {}),
    };
  });

  // Signature covers the prompt-relevant content (names + due labels) so a new
  // test or a date shift regenerates instead of serving a stale orientation.
  const sig = JSON.stringify({ u: user.id, tz, d: todayYmd, c: upcoming.length, t: top.map((t) => `${t.name}:${t.dueLabel}:${t.dueYmd ?? ""}`) });
  const key = createHash("sha1").update(sig).digest("hex");
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json({ summary: hit.summary });

  const res = await generateStudyHub({ firstName, count: upcoming.length, top, todayYmd });
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
