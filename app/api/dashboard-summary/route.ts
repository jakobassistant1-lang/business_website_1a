import { NextResponse } from "next/server";
import { DEFAULT_EFFORT_HOURS } from "@/lib/effort";
import { createHash } from "crypto";
import { requireActiveUser } from "@/lib/access";
import { loadCalendarData } from "@/lib/calendarData";
import { ymdInZone } from "@/lib/calendarDates";
import { studentZone, todayInZone } from "@/lib/studentZone";
import { round1 } from "@/lib/round";
import { generateDashboardSummary, VOICE_VERSION, type PromptItem } from "@/lib/briefing";
import { deterministicIntensity, overdueLoad, type Intensity } from "@/lib/intensity";

export const dynamic = "force-dynamic";

// Best-effort in-process cache (per warm instance) so a dashboard load / autosync
// refresh doesn't re-hit Gemini. Only real Gemini results are cached — a fallback
// stays uncached so the next load retries through a transient outage.
const CACHE = new Map<string, { points: string[]; intensity: Intensity; at: number }>();
const TTL_MS = 30 * 60_000;
const MAX = 200;

// GET /api/dashboard-summary — { points, intensity }. `points` is [] when the
// AI is unavailable; `intensity` ALWAYS resolves (deterministic fallback).
export async function GET() {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const zone = studentZone(user); // THE date zone: the student's Canvas profile zone
  const now = new Date();
  const data = await loadCalendarData(user.id);

  // Week load — mirrors the "This week" KPI so the rating matches what the student
  // reads there. Overdue work counts too (#62): rating only the `windowDates` slice
  // let a week with a pile of overdue assignments come back "easy".
  const windowDates = new Set(data.plan.days.map((d) => d.date));
  const dueThisWeekItems = data.items.filter((it) => it.dueAt && windowDates.has(ymdInZone(it.dueAt, zone)));
  const examQuiz = dueThisWeekItems.filter((it) => it.type === "exam" || it.type === "quiz").length;
  const planned = data.plan.days.reduce((s, d) => s + d.allocated, 0);
  const budgetHours = round1(data.hoursPerDay * data.plan.days.length);
  const workHours = round1(planned + data.overloadHours);
  const load = {
    dueThisWeek: dueThisWeekItems.length,
    examQuiz,
    workHours,
    budgetHours,
    overloadHours: data.overloadHours,
    ...overdueLoad(data.items, data.defaultEffortHours ?? DEFAULT_EFFORT_HOURS),
  };
  // `recommendations` = the Focus slice of the app's importance order — past-due
  // work INCLUDED (lib/rankActive.focusSlice), so a top item can read "past due by
  // N days". Joined to the items for the facts the screen shows.
  const byId = new Map(data.items.map((it) => [it.canvasId, it] as const));
  const top: PromptItem[] = data.recommendations.slice(0, 3).map((r) => {
    const it = byId.get(r.canvasId);
    return {
      name: r.name,
      courseName: r.courseName,
      type: it?.type ?? "assignment",
      dueAt: it?.dueAt ?? null,
      points: it?.pointsPossible ?? null,
      effortHours: it?.estimatedEffortHours ?? null,
    };
  });

  // Nothing to brief → deterministic rating, skip the AI call entirely.
  if (top.length === 0 && load.dueThisWeek === 0 && load.overdueCount === 0) {
    return NextResponse.json({ points: [], intensity: deterministicIntensity(load) });
  }

  // Signature covers everything the prompt says (each item's name and due, the
  // zone and today — day counts move daily) plus the prompt version, so a rename
  // or a prompt change regenerates instead of serving stale text.
  const sig = JSON.stringify({
    ver: VOICE_VERSION,
    u: user.id,
    z: zone,
    today: todayInZone(zone, now),
    ...load,
    t: top.map((t) => `${t.name}:${t.dueAt}:${t.points ?? ""}:${t.effortHours ?? ""}`),
  });
  const key = createHash("sha1").update(sig).digest("hex");
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json({ points: hit.points, intensity: hit.intensity });
  }

  const result = await generateDashboardSummary({
    windowDays: data.plan.days.length,
    top,
    timeZone: zone,
    now,
    ...load,
  });

  if (result.source === "gemini") {
    if (CACHE.size >= MAX) {
      const oldest = CACHE.keys().next().value;
      if (oldest) CACHE.delete(oldest);
    }
    CACHE.set(key, { points: result.points, intensity: result.intensity, at: Date.now() });
  } else {
    console.warn("[dashboard-summary] gemini unavailable — deterministic rating used");
  }

  return NextResponse.json({ points: result.points, intensity: result.intensity });
}
