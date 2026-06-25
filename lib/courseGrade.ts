// One honest answer to "what grade should we show for this course?" — derived from
// Canvas's OWN computed total plus whether the student has any graded work.
//
// The whole point of this module is NO GUESSWORK. We only ever surface a number
// Canvas itself computed. When Canvas returns no total we distinguish the two real
// reasons — the instructor HIDES totals from students, vs. nothing is graded yet —
// and label them, rather than inventing an estimate from raw points.

export type CourseGradeState = "graded" | "hidden" | "none";

export interface CourseGrade {
  state: CourseGradeState;
  score: number | null; // 0–100, only when state === "graded"
  letter: string | null; // e.g. "B+", only when Canvas provides one
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Decide what to show for a course's grade.
 *  - Canvas returned a computed total → "graded" (show the real number).
 *  - No total, but the student HAS graded work → the instructor hides totals in
 *    Canvas → "hidden" (we say so; we never estimate).
 *  - No total and nothing graded yet → "none".
 */
export function deriveCourseGrade(
  officialScore: number | null | undefined,
  officialLetter: string | null | undefined,
  hasGradedWork: boolean,
): CourseGrade {
  if (typeof officialScore === "number" && Number.isFinite(officialScore)) {
    const letter = (officialLetter ?? "").trim();
    return { state: "graded", score: round1(officialScore), letter: letter || null };
  }
  if (hasGradedWork) return { state: "hidden", score: null, letter: null };
  return { state: "none", score: null, letter: null };
}

export type GradeBand = "high" | "good" | "fair" | "low";

/** Coarse performance band — used for color only, and respects the no-amber
 *  palette (fair maps to the calm violet-grey "warning", not yellow). */
export function gradeBand(score: number): GradeBand {
  if (score >= 90) return "high";
  if (score >= 80) return "good";
  if (score >= 70) return "fair";
  return "low";
}
