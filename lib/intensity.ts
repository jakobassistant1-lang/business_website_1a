// Client-safe week-intensity rating — used by the Dashboard KPI (instant baseline)
// and the /api/dashboard-summary endpoint (Gemini's fallback). Pure: no Gemini,
// no env, no node imports, so it can be bundled into the browser.

export type Intensity = "easy" | "moderate" | "hard";

export interface WeekLoad {
  dueThisWeek: number;
  examQuiz: number;
  workHours: number;
  budgetHours: number;
  overloadHours: number;
}

/** A deterministic Easy/Moderate/Hard read of the week from its shape. Drives the
 *  KPI instantly and is the fail-open fallback when Gemini's verdict is missing. */
export function deterministicIntensity(w: WeekLoad): Intensity {
  const load = w.budgetHours > 0 ? w.workHours / w.budgetHours : 0;
  if (w.overloadHours >= 1 || w.examQuiz >= 2 || load >= 0.85) return "hard";
  if (w.examQuiz >= 1 || load >= 0.5 || w.dueThisWeek >= 4) return "moderate";
  return "easy";
}
