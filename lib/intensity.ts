// Client-safe week-intensity rating — used by the Dashboard KPI (instant baseline)
// and the /api/dashboard-summary endpoint (Gemini's fallback AND its clamp). Pure:
// no Gemini, no env, no node imports, so it can be bundled into the browser.

import { effectiveEffort } from "./effort";
import { round1 } from "./round";

export type Intensity = "easy" | "moderate" | "hard";

export interface WeekLoad {
  dueThisWeek: number;
  examQuiz: number;
  workHours: number;
  budgetHours: number;
  overloadHours: number;
  // Overdue work is PART of the week's load (#62 regression: a week with 16 overdue
  // assignments rated "Easy" because only `windowDates` work reached the rating).
  overdueCount: number;
  overdueHours: number; // effective effort of the overdue items (unknown ⇒ 0)
}

/** Rows the overdue slice can be read off — `CalendarData.items` shape, narrowed. */
export interface OverdueSource {
  status?: string;
  effortOverrideHours?: number | null;
  estimatedEffortHours?: number | null;
}

const RANK: Record<Intensity, number> = { easy: 0, moderate: 1, hard: 2 };
/** The more demanding of two ratings — a rating is only ever raised, never lowered. */
export function maxIntensity(a: Intensity, b: Intensity): Intensity {
  return RANK[a] >= RANK[b] ? a : b;
}

/** The overdue half of `WeekLoad`, from the same items the dashboard lists.
 *  Effort goes through the canonical `effectiveEffort` (never `estimatedEffortHours`
 *  raw); an item with no estimate contributes 0 hours but still counts. */
export function overdueLoad(items: readonly OverdueSource[]): { overdueCount: number; overdueHours: number } {
  const overdue = items.filter((it) => it.status === "overdue");
  const hours = overdue.reduce((s, it) => s + (effectiveEffort(it) ?? 0), 0);
  return { overdueCount: overdue.length, overdueHours: round1(hours) };
}

/** The floor a pile of overdue work puts under the week, whatever else is true:
 *  ≥3 items or ≥4h overdue can never read below "moderate"; ≥8 items or ≥10h is
 *  "hard" regardless. This is what the Gemini overlay is clamped to. */
export function intensityFloor(w: Pick<WeekLoad, "overdueCount" | "overdueHours">): Intensity {
  if (w.overdueCount >= 8 || w.overdueHours >= 10) return "hard";
  if (w.overdueCount >= 3 || w.overdueHours >= 4) return "moderate";
  return "easy";
}

/** A deterministic Easy/Moderate/Hard read of the week from its shape. Drives the
 *  KPI instantly and is the fail-open fallback when Gemini's verdict is missing.
 *  Overdue hours count toward the week's work, and `intensityFloor` is applied last. */
export function deterministicIntensity(w: WeekLoad): Intensity {
  const hours = w.workHours + w.overdueHours;
  const load = w.budgetHours > 0 ? hours / w.budgetHours : 0;
  const base: Intensity =
    w.overloadHours >= 1 || w.examQuiz >= 2 || load >= 0.85
      ? "hard"
      : w.examQuiz >= 1 || load >= 0.5 || w.dueThisWeek >= 4
        ? "moderate"
        : "easy";
  return maxIntensity(base, intensityFloor(w));
}

/** THE one place an AI week rating is merged with the deterministic one: Gemini may
 *  raise the rating (or lower it within an honest week), but never below the overdue
 *  floor — so "easy" over 16 overdue assignments is impossible from either path.
 *  No verdict (null) ⇒ the deterministic rating. */
export function resolveIntensity(ai: Intensity | null | undefined, w: WeekLoad): Intensity {
  if (!ai) return deterministicIntensity(w);
  return maxIntensity(ai, intensityFloor(w));
}
