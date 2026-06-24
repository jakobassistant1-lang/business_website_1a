// Navo v1 prioritizer — the "Expected-Points Maximizer" (docs/navo-priority-v1-spec.md).
//
// Ranks every active item by the MARGINAL EXPECTED GRADE-% it puts at stake, per
// hour of effort:
//
//   score = leverage(grade) · weight · captureFraction · submittedFactor / effortHours
//
// Derived from 25 revealed-preference answers + 3 validation scenarios
// (docs/navo-priority-preferences.md). There are NO hard tiers — "overdue-first",
// "imminent", "undated-last" all emerge from this one score. Pure + deterministic.
// The constants below are TUNED to reproduce the acceptance set
// (tests/marginalPriority.test.ts); change them only against those tests.

import type { LatePolicy } from "./latePolicy";
import { salvageFraction, slipLoss } from "./latePolicy";

export type ItemKind = "assignment" | "study";

export interface MarginalInput {
  canvasId: number;
  name: string;
  courseName: string;
  kind: ItemKind; // "assignment" = you submit it; "study" = prep for an exam/quiz
  weight: number; // share of the course's final grade, 0..1 (points already → %; see lib/gradeWeight)
  courseGrade: number | null; // current grade fraction 0..1; null = unknown
  dueInDays: number | null; // days to the due date (assignment) / to the exam (study); null = undated
  effortHours: number;
  latePolicy: LatePolicy; // assignment only; how much a slip / being late actually costs
  submitted?: boolean;
}

// --- tunable constants (fit to the acceptance set; see spec §9) ---
export const LAMBDA = 0.02; // inherent "you'll do it eventually" floor → weight-orders non-urgent work
export const LEVERAGE_FLOOR = 0.1; // a locked-A class still has *some* pull
export const DEFAULT_GRADE = 0.85; // unknown grade → neutral-ish leverage
export const DEFAULT_STUDY_BASELINE = 0.5; // unknown grade → assume ~half-known cold (study headroom)
export const EFFORT_FLOOR = 0.25; // ε hours: a 5-min task gets high but FINITE ROI
export const SUBMITTED_FACTOR = 0.1; // already-submitted work sinks, never vanishes
export const OVERDUE_FRACTION = 0.5; // recoverable overdue: catch-up urgency on the still-winnable credit

// Piecewise-linear control points (x ascending). lerp() clamps outside the range.
// URGENCY: an assignment's deadline pressure by days-to-due. Flat through the
// imminent tier (≤2 days), a steep cliff at day 3 (so a due-tomorrow item beats
// 13× the points, Q2, while non-imminent items order by weight, Q3), then a GENTLE
// tail out to ~a month — so among the non-imminent pile, sooner still beats later
// (a thing due in 7 days outranks one due in 42, all else equal). Verified on real
// sandbox data, where everything is weeks out and the tail does the ordering.
const URGENCY_CURVE: [number, number][] = [
  [0, 1],
  [1, 1],
  [2, 1],
  [3, 0.04],
  [30, 0],
];
// STUDY: prep pressure by days-to-exam. Climbs steeply as the exam nears (Q8),
// is modest a couple days out (Q7), small at 3 days (Q5/Q16/Q17), gone by 5 (Q20).
const STUDY_CURVE: [number, number][] = [
  [0, 1],
  [1, 1],
  [2, 0.55],
  [3, 0.085],
  [5, 0],
];

function lerp(curve: [number, number][], x: number): number {
  if (x <= curve[0][0]) return curve[0][1];
  const last = curve[curve.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < curve.length; i++) {
    const [x0, y0] = curve[i - 1];
    const [x1, y1] = curve[i];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return last[1];
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Marginal utility of a grade-point in this course: high when the grade is at
 *  risk (low), small (floored) when it's a locked-in A. */
export function leverage(grade: number | null): number {
  const g = grade ?? DEFAULT_GRADE;
  return clamp(1 - g, LEVERAGE_FLOOR, 1);
}

/** Capture fraction: the share of `weight` this item puts at stake right now. */
export function captureFraction(i: MarginalInput): number {
  if (i.kind === "study") {
    const d = i.dueInDays;
    if (d === null || d < 0) return 0; // undated / the exam already happened → nothing to win
    const baseline = i.courseGrade ?? DEFAULT_STUDY_BASELINE;
    const improvement = clamp(1 - baseline, 0, 1); // studying only buys headroom over your baseline
    return improvement * lerp(STUDY_CURVE, d);
  }
  // assignment
  const d = i.dueInDays;
  if (d === null) return LAMBDA; // undated: inherent value only → ranks as low-urgency backfill
  if (d < 0) {
    // Overdue: rank by the credit STILL recoverable, at a catch-up urgency. No late
    // credit (or a per-day policy fully bled out) → salvage 0 → dropped. A per-day
    // policy keeps bleeding, so its salvage — and thus its priority — shrinks the
    // longer it sits. Grade-leverage still applies, so a trivial forgiving overdue
    // in a locked-A class stays buried (Scenario A/e) while a real one floats up (Q9).
    return salvageFraction(i.latePolicy, -d) * OVERDUE_FRACTION;
  }
  const pressure = lerp(URGENCY_CURVE, d) * slipLoss(i.latePolicy);
  return LAMBDA + (1 - LAMBDA) * pressure;
}

export interface MarginalScore {
  canvasId: number;
  name: string;
  courseName: string;
  score: number; // marginal grade-% per hour — the ranking value
  value: number; // marginal grade-% at stake (leverage·capture), NOT per hour — for the scheduler's slack split
  capture: number; // grade-% at stake (weight·captureFraction)
  leverage: number;
}

export function scoreItem(i: MarginalInput): MarginalScore {
  const lev = leverage(i.courseGrade);
  const cap = Math.max(0, i.weight) * captureFraction(i);
  const submitted = i.submitted ? SUBMITTED_FACTOR : 1;
  const value = lev * cap * submitted;
  const score = value / Math.max(i.effortHours, EFFORT_FLOOR);
  return { canvasId: i.canvasId, name: i.name, courseName: i.courseName, score, value, capture: cap, leverage: lev };
}

/** Rank items by IMPORTANCE — the marginal grade-% at stake (`value`), highest
 *  first. **Dated work comes first** (Calvin): an item with a due date outranks any
 *  undated item regardless of weight — undated work is backfill, even when it's a
 *  big slice of the grade. The ONE exception: a past-due item with no recoverable
 *  credit (salvage 0 → value 0) is DEAD — there's nothing left to earn — so it sinks
 *  to the very bottom, below even undated work, instead of floating up with the
 *  dated group just because its date is in the past. A still-recoverable overdue
 *  item (per-day policy with credit left → value > 0) is NOT dead and still catches
 *  up (Q9). Within each group, order by `value`, then name for determinism.
 *  (Per-hour ROI — `score` — is for the scheduler's slack split, not the importance
 *  rank: a 5-minute discussion is a quick win, not a high-importance item.) */
export function rankItems(items: MarginalInput[]): MarginalScore[] {
  const scored = items.map((i) => {
    const s = scoreItem(i);
    const dead = i.dueInDays !== null && i.dueInDays < 0 && s.value <= 1e-9; // overdue, no credit recoverable
    return { s, undated: i.dueInDays === null, dead };
  });
  scored.sort(
    (a, b) =>
      Number(a.dead) - Number(b.dead) || // dead (unrecoverable overdue) to the very bottom
      Number(a.undated) - Number(b.undated) || // then dated-first; undated is backfill
      b.s.value - a.s.value ||
      a.s.name.localeCompare(b.s.name),
  );
  return scored.map((x) => x.s);
}
