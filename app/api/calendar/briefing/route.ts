import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { requireUser } from "@/lib/auth";
import { loadCalendarData } from "@/lib/calendarData";
import { generatePeriodBriefing, DEFAULT_PERIOD_COACH_INSTRUCTION, type PeriodTopItem } from "@/lib/briefing";
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

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseYmd(s: string | null): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}
function effortLabel(it: { estimatedEffortHours: number | null; effortBucket: string | null }): string | null {
  if (it.estimatedEffortHours != null && it.estimatedEffortHours > 0) return `${Math.round(it.estimatedEffortHours * 10) / 10}h`;
  return it.effortBucket ?? null;
}
function dueLabel(iso: string, view: "day" | "week" | "month"): string {
  const d = new Date(iso);
  if (view === "day") return d.toLocaleString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}`;
}
function rangeLabelFor(view: "day" | "week" | "month", start: Date, end: Date): string {
  if (view === "day") {
    const today = startOfLocalDay(new Date());
    if (start.getTime() === today.getTime()) return "today";
    return `${MON[start.getMonth()]} ${start.getDate()}`;
  }
  if (view === "month") return `${MONTHS[start.getMonth()]} ${start.getFullYear()}`;
  const last = new Date(end);
  last.setDate(last.getDate() - 1);
  return `${MON[start.getMonth()]} ${start.getDate()}–${MON[last.getMonth()] !== MON[start.getMonth()] ? `${MON[last.getMonth()]} ` : ""}${last.getDate()}`;
}

// GET /api/calendar/briefing?view=day|week|month&start=YYYY-MM-DD&days=N
// AI "study coach" game plan for the selected period. Always degrades: returns
// text=null whenever the AI is unavailable, so the view renders without it.
export async function GET(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const viewRaw = url.searchParams.get("view");
  const view: "day" | "week" | "month" = viewRaw === "week" || viewRaw === "month" ? viewRaw : "day";
  const start = parseYmd(url.searchParams.get("start")) ?? startOfLocalDay(new Date());
  const daysRaw = Number(url.searchParams.get("days"));
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(45, Math.floor(daysRaw)) : view === "day" ? 1 : view === "week" ? 7 : 31;
  const end = new Date(start);
  end.setDate(end.getDate() + days);

  const data = await loadCalendarData(user.id);
  if (!data.connected) return NextResponse.json({ ok: false, text: null, reason: "not_connected" });

  const inRange = data.items.filter((it) => {
    if (!it.dueAt) return false;
    const d = new Date(it.dueAt);
    return d >= start && d < end;
  });
  if (inRange.length === 0) return NextResponse.json({ ok: false, text: null, reason: "empty_period" });

  const atRiskCount = inRange.filter((it) => it.status === "overdue").length;
  const busyHours = data.events
    .filter((e) => !e.allDay)
    .reduce((s, e) => {
      const lo = Math.max(new Date(e.startTime).getTime(), start.getTime());
      const hi = Math.min(new Date(e.endTime).getTime(), end.getTime());
      return hi > lo ? s + (hi - lo) / 3_600_000 : s;
    }, 0);

  const top: PeriodTopItem[] = [...inRange]
    .sort((a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime())
    .slice(0, 5)
    .map((it) => ({ name: it.name, courseName: it.courseName, dueLabel: dueLabel(it.dueAt!, view), effort: effortLabel(it), type: it.type }));

  const instruction = (await getSetting(PERIOD_COACH_PROMPT_KEY)) || DEFAULT_PERIOD_COACH_INSTRUCTION;
  const sig = JSON.stringify({
    u: user.id,
    v: view,
    s: ymd(start),
    n: days,
    d: inRange.length,
    r: atRiskCount,
    b: Math.round(busyHours),
    p: instruction,
    t: top.map((t) => `${t.name}:${t.dueLabel}`),
  });
  const key = createHash("sha1").update(sig).digest("hex");
  const cached = cacheGet(key);
  if (cached) return NextResponse.json({ ok: true, text: cached, cached: true });

  const result = await generatePeriodBriefing(
    {
      firstName: user.fullName.trim().split(/\s+/)[0] ?? "",
      period: view,
      rangeLabel: rangeLabelFor(view, start, end),
      dueCount: inRange.length,
      atRiskCount,
      busyHours,
      top,
    },
    instruction,
  );

  if (result.ok) cacheSet(key, result.text);
  else console.warn(`[period-coach] gemini unavailable: ${result.reason}`); // reason only, never the key
  return NextResponse.json({ ok: result.ok, text: result.ok ? result.text : null, reason: result.ok ? undefined : result.reason });
}
