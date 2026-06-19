import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { requireUser } from "@/lib/auth";
import { loadCalendarData } from "@/lib/calendarData";
import { ymd } from "@/lib/calendarDates";
import { round1 } from "@/lib/round";
import { generateDashboardSummary } from "@/lib/briefing";
import { deterministicIntensity, type Intensity } from "@/lib/intensity";

export const dynamic = "force-dynamic";

// Best-effort in-process cache (per warm instance) so a dashboard load / autosync
// refresh doesn't re-hit Gemini. Only real Gemini results are cached — a fallback
// stays uncached so the next load retries through a transient outage.
const CACHE = new Map<string, { summary: string | null; intensity: Intensity; at: number }>();
const TTL_MS = 30 * 60_000;
const MAX = 200;

// GET /api/dashboard-summary — { summary, intensity }. `summary` is null when the
// AI is unavailable; `intensity` ALWAYS resolves (deterministic fallback).
export async function GET() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const data = await loadCalendarData(user.id);

  // Week load — mirrors the old "This week" card so the rating matches what the
  // student would have read there.
  const windowDates = new Set(data.plan.days.map((d) => d.date));
  const dueThisWeekItems = data.items.filter((it) => it.dueAt && windowDates.has(ymd(new Date(it.dueAt))));
  const examQuiz = dueThisWeekItems.filter((it) => it.type === "exam" || it.type === "quiz").length;
  const planned = data.plan.days.reduce((s, d) => s + d.allocated, 0);
  const budgetHours = round1(data.hoursPerDay * data.plan.days.length);
  const workHours = round1(planned + data.overloadHours);
  const load = { dueThisWeek: dueThisWeekItems.length, examQuiz, workHours, budgetHours, overloadHours: data.overloadHours };
  const top = data.recommendations.slice(0, 3);

  // Nothing to brief → deterministic rating, skip the AI call entirely.
  if (top.length === 0 && load.dueThisWeek === 0) {
    return NextResponse.json({ summary: null, intensity: deterministicIntensity(load) });
  }

  const sig = JSON.stringify({ u: user.id, ...load, r: data.atRisk.length, t: top.map((t) => `${t.canvasId}:${t.score}`) });
  const key = createHash("sha1").update(sig).digest("hex");
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json({ summary: hit.summary, intensity: hit.intensity });
  }

  const result = await generateDashboardSummary({
    firstName: user.fullName.trim().split(/\s+/)[0] ?? "",
    windowDays: data.plan.days.length,
    atRiskCount: data.atRisk.length,
    top,
    ...load,
  });

  if (result.source === "gemini") {
    if (CACHE.size >= MAX) {
      const oldest = CACHE.keys().next().value;
      if (oldest) CACHE.delete(oldest);
    }
    CACHE.set(key, { summary: result.summary, intensity: result.intensity, at: Date.now() });
  } else {
    console.warn("[dashboard-summary] gemini unavailable — deterministic rating used");
  }

  return NextResponse.json({ summary: result.summary, intensity: result.intensity });
}
