import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { requireActiveUser } from "@/lib/access";
import { loadCalendarData } from "@/lib/calendarData";
import { MONTHS_LONG, MONTHS_SHORT, parseYmd, ymd, ymdInZone } from "@/lib/calendarDates";
import { studentZone, todayInZone } from "@/lib/studentZone";
import { generatePeriodBriefing, DEFAULT_PERIOD_COACH_INSTRUCTION, VOICE_VERSION, type PromptItem } from "@/lib/briefing";
import { getSetting, PERIOD_COACH_PROMPT_KEY } from "@/lib/settings";

export const dynamic = "force-dynamic";

// In-process cache (per warm instance) so navigating periods doesn't re-call
// Gemini for the same range. TTL- and size-bounded.
const CACHE = new Map<string, { text: string; at: number }>();
const TTL_MS = 30 * 60_000;
const MAX = 200;
function cacheGet(key: string): string | null {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    CACHE.delete(key);
    return null;
  }
  return hit.text;
}
function cacheSet(key: string, text: string) {
  if (CACHE.size >= MAX) {
    const oldest = CACHE.keys().next().value;
    if (oldest) CACHE.delete(oldest);
  }
  CACHE.set(key, { text, at: Date.now() });
}

/** A calendar day `n` days after `dayYmd` (zone-free calendar arithmetic). */
function addDaysYmd(dayYmd: string, n: number): string {
  const d = parseYmd(dayYmd);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
function rangeLabelFor(view: "day" | "week" | "month", startYmd: string, endYmd: string, todayYmd: string): string {
  const start = parseYmd(startYmd);
  if (view === "day") return startYmd === todayYmd ? "today" : `${MONTHS_SHORT[start.getMonth()]} ${start.getDate()}`;
  if (view === "month") return `${MONTHS_LONG[start.getMonth()]} ${start.getFullYear()}`;
  const last = parseYmd(addDaysYmd(endYmd, -1));
  const sameMonth = last.getMonth() === start.getMonth();
  return `${MONTHS_SHORT[start.getMonth()]} ${start.getDate()}–${sameMonth ? "" : `${MONTHS_SHORT[last.getMonth()]} `}${last.getDate()}`;
}

// GET /api/calendar/briefing?view=day|week|month&start=YYYY-MM-DD&days=N
// AI "study coach" game plan for the selected period. Always degrades: returns
// text=null whenever the AI is unavailable, so the view renders without it.
// Every day here is read in the student's Canvas zone (lib/studentZone), and the
// items reach the model in the app's IMPORTANCE order (CalendarData.ranked — the
// same order the Dashboard and Plan list show), never re-sorted by due date.
export async function GET(req: Request) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const zone = studentZone(user);
  const now = new Date();
  const todayYmd = todayInZone(zone, now);

  const url = new URL(req.url);
  const viewRaw = url.searchParams.get("view");
  const view: "day" | "week" | "month" = viewRaw === "week" || viewRaw === "month" ? viewRaw : "day";
  const startParam = url.searchParams.get("start");
  const startYmd = startParam && /^\d{4}-\d{2}-\d{2}$/.test(startParam) && !Number.isNaN(parseYmd(startParam).getTime()) ? startParam : todayYmd;
  const daysRaw = Number(url.searchParams.get("days"));
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(45, Math.floor(daysRaw)) : view === "day" ? 1 : view === "week" ? 7 : 31;
  const endYmd = addDaysYmd(startYmd, days); // exclusive
  const inPeriod = (iso: string) => {
    const d = ymdInZone(iso, zone);
    return d >= startYmd && d < endYmd;
  };

  const data = await loadCalendarData(user.id);
  if (!data.connected) return NextResponse.json({ ok: false, text: null, reason: "not_connected" });

  // Active work only: a done item is not part of the period's game plan.
  const inRange = data.items.filter((it) => it.status !== "done" && it.dueAt && inPeriod(it.dueAt));
  if (inRange.length === 0) return NextResponse.json({ ok: false, text: null, reason: "empty_period" });

  const pastDueCount = inRange.filter((it) => it.status === "overdue").length;
  const busyHours = data.events
    .filter((e) => !e.allDay && inPeriod(new Date(e.startTime).toISOString()))
    .reduce((s, e) => s + Math.max(0, new Date(e.endTime).getTime() - new Date(e.startTime).getTime()) / 3_600_000, 0);

  // The app's importance order (the full `ranked` list); anything unranked goes
  // last, earliest-due first.
  const rank = new Map(data.ranked.map((r, i) => [r.canvasId, i] as const));
  const top: PromptItem[] = [...inRange]
    .sort((a, b) => {
      const ra = rank.get(a.canvasId) ?? 1e9;
      const rb = rank.get(b.canvasId) ?? 1e9;
      return ra !== rb ? ra - rb : new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime();
    })
    .slice(0, 5)
    .map((it) => ({
      name: it.name,
      courseName: it.courseName,
      type: it.type,
      dueAt: it.dueAt,
      points: it.pointsPossible,
      effortHours: it.estimatedEffortHours, // effectiveEffort; worded once by effortHoursText in the builder
    }));

  const instruction = (await getSetting(PERIOD_COACH_PROMPT_KEY)) || DEFAULT_PERIOD_COACH_INSTRUCTION;
  const sig = JSON.stringify({
    ver: VOICE_VERSION,
    u: user.id,
    z: zone,
    today: todayYmd,
    v: view,
    s: startYmd,
    n: days,
    d: inRange.length,
    r: pastDueCount,
    b: Math.round(busyHours),
    p: instruction,
    t: top.map((t) => `${t.name}:${t.dueAt}:${t.effortHours ?? ""}`),
  });
  const key = createHash("sha1").update(sig).digest("hex");
  const cached = cacheGet(key);
  if (cached) return NextResponse.json({ ok: true, text: cached, cached: true });

  const result = await generatePeriodBriefing(
    {
      period: view,
      rangeLabel: rangeLabelFor(view, startYmd, endYmd, todayYmd),
      dueCount: inRange.length,
      pastDueCount,
      busyHours,
      top,
      timeZone: zone,
      now,
    },
    instruction,
  );

  if (result.ok) cacheSet(key, result.text);
  else console.warn(`[period-coach] gemini unavailable: ${result.reason}`); // reason only, never the key
  return NextResponse.json({ ok: result.ok, text: result.ok ? result.text : null, reason: result.ok ? undefined : result.reason });
}
