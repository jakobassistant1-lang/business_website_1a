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
//
// Owner's ranking rules (2026-09-28, tests/rankingRules.test.ts):
//  • ZERO importance: past due with nothing left to earn, unopened by the teacher
//    (`locked`), and passive grades (participation) score 0 and sit at the very
//    bottom — below undated work — still listed. Non-zero dated work stays above
//    non-zero undated work (dated-first).
//  • UNKNOWN late policy (`latePolicy: null`, no stored policy) past due: full
//    importance-at-the-due-date for days late 1–2, half for days 3–4, 0 from day 5
//    (UNKNOWN_LATE_*). A KNOWN "none" is 0 at once; per-day/flat use salvage.
//  • TIEBREAKERS (`compareTiebreak`): importance equal to 5 significant digits →
//    earlier due date → bigger share of grade → lower course grade (unknown last)
//    → natural name order ("Prep 2" < "Prep 10") → canvasId.

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
  dueInDays: number | null; // calendar days to the due date / exam IN THE STUDENT'S ZONE (lib/studentZone.dayDiffInZone); null = undated
  effortHours: number;
  /** Assignment only: how much a slip / being late costs. null = UNKNOWN (the course
   *  has no stored policy) — on time it is treated like "none" (max deadline
   *  pressure); past due it follows the UNKNOWN_LATE_* schedule, never "none". */
  latePolicy: LatePolicy | null;
  submitted?: boolean;
  /** The teacher hasn't opened it yet (unlock date in the future) → importance 0. */
  locked?: boolean;
  /** A passive grade (participation / attendance, lib/itemType.isPassiveItem) → importance 0. */
  passive?: boolean;
  /** The due instant (ms since epoch) for the due-date tiebreak; absent → dueInDays is used. */
  dueAtMs?: number | null;
  /** The due INSTANT is already behind us (dueAt < now). A study item (exam/quiz)
   *  scores 0 from that moment — even on its own day (it ended at 9 AM, it's 3 PM). */
  duePassed?: boolean;
  /** Raw points — a tiebreak only BETWEEN ITEMS OF THE SAME COURSE (see compareTiebreak). */
  points?: number | null;
  /** Course identity for the same-course points tiebreak (courseName is used too). */
  courseId?: number | null;
}

// --- tunable constants (fit to the acceptance set; see spec §9) ---
export const LAMBDA = 0.02; // inherent "you'll do it eventually" floor → weight-orders non-urgent work
export const LEVERAGE_FLOOR = 0.1; // a locked-A class still has *some* pull
export const DEFAULT_GRADE = 0.85; // unknown grade → neutral-ish leverage
export const DEFAULT_STUDY_BASELINE = 0.5; // unknown grade → assume ~half-known cold (study headroom)
export const EFFORT_FLOOR = 0.25; // ε hours: a 5-min task gets high but FINITE ROI
export const SUBMITTED_FACTOR = 0.1; // already-submitted work sinks, never vanishes
export const OVERDUE_FRACTION = 0.5; // recoverable overdue: catch-up urgency on the still-winnable credit

// Past due with an UNKNOWN late policy (owner, 2026-09-28): "full importance
// according to the formula for 2 days, … then 50%, … then 0 but not disappear".
// The base is the importance the item had AT its due date (urgency at its maximum).
export const UNKNOWN_LATE_FULL_DAYS = 2; // days late 1..2 → 100%
export const UNKNOWN_LATE_HALF_DAYS = 4; // days late 3..4 → UNKNOWN_LATE_HALF_FRACTION
export const UNKNOWN_LATE_HALF_FRACTION = 0.5; // days late ≥ 5 → 0 (still listed, at the bottom)

/** Share of its at-the-due-date importance an UNKNOWN-policy item keeps `daysLate` days late. */
export function unknownLateFactor(daysLate: number): number {
  if (daysLate <= UNKNOWN_LATE_FULL_DAYS) return 1;
  if (daysLate <= UNKNOWN_LATE_HALF_DAYS) return UNKNOWN_LATE_HALF_FRACTION;
  return 0;
}

/** Two importance values are TIED when equal to this many significant digits.
 *  Implemented as BUCKETING (`importanceBucket`: `toPrecision(5)`), not as "within
 *  a tolerance": every value falls in exactly one bucket, so "tied" is transitive
 *  and the sort is a strict total order. The cost is at a bucket EDGE: 0.123455 and
 *  0.123449 differ by only 6e-6 yet land in different buckets (0.12346 / 0.12345),
 *  so the first outranks the second outright, while 0.123450 and 0.123459 (a bigger
 *  gap) tie. Accepted: deterministic beats "nearly equal" fuzziness. */
export const TIE_SIGNIFICANT_DIGITS = 5;
/** At or below this, an importance counts as 0 (floating-point dust from a bled-out per-day policy). */
export const ZERO_IMPORTANCE = 1e-9;

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
  if (i.locked || i.passive) return 0; // unopened / passive: nothing to act on (owner, 2026-09-28)
  if (i.kind === "study") {
    const d = i.dueInDays;
    if (d === null || d < 0) return 0; // undated / the exam already happened → nothing to win
    if (i.duePassed) return 0; // it ended earlier today → nothing left to study for (done tomorrow by the date rule)
    const baseline = i.courseGrade ?? DEFAULT_STUDY_BASELINE;
    const improvement = clamp(1 - baseline, 0, 1); // studying only buys headroom over your baseline
    return improvement * lerp(STUDY_CURVE, d);
  }
  // assignment
  const d = i.dueInDays;
  if (d === null) return LAMBDA; // undated: inherent value only → ranks as low-urgency backfill
  if (d < 0) {
    // UNKNOWN policy: keep the importance it had at the due date (urgency at its
    // maximum, no-credit pressure), then decay on the owner's schedule.
    if (i.latePolicy === null) return (LAMBDA + (1 - LAMBDA) * lerp(URGENCY_CURVE, 0)) * unknownLateFactor(-d);
    // KNOWN policy: rank by the credit STILL recoverable, at a catch-up urgency. No
    // late credit (or a per-day policy fully bled out) → salvage 0 → importance 0.
    // A per-day policy keeps bleeding, so its salvage — and thus its priority —
    // shrinks the longer it sits. Grade-leverage still applies, so a trivial
    // forgiving overdue in a locked-A class stays buried (Scenario A/e) while a real
    // one floats up (Q9).
    return salvageFraction(i.latePolicy, -d) * OVERDUE_FRACTION;
  }
  // On time: an unknown policy carries full slip pressure (like "none", spec §5).
  // A NO-PENALTY policy (late accepted, nothing lost → slipLoss 0) keeps a pressure
  // floor of OVERDUE_FRACTION, so its importance never JUMPS up when the deadline
  // passes (orchestrator's call, 2026-09-28: without it the item scored λ = 0.02
  // the day before and 0.5 the day after).
  const slip = i.latePolicy === null ? 1 : slipLoss(i.latePolicy);
  const floor = i.latePolicy !== null && i.latePolicy.kind !== "none" && slip === 0 ? OVERDUE_FRACTION : 0;
  // ⚠️ OWNER DECISION PENDING (review, 2026-09-28) — a SMALL-penalty policy still
  // RISES when its deadline passes: per-day 10% = 0.118 × weight the day before vs
  // 0.45 the day after; flat 20% = 0.216 vs 0.40 (tests/rankingRules.test.ts todo).
  // The reviewer's alternative, to implement HERE (and in the d < 0 branch above)
  // if the owner picks it: for any policy that accepts late work (flat / per-day),
  // floor the before-deadline pressure at ≈ 0.30 instead of slip/OVERDUE_FRACTION,
  // and cap the past-due capture at the capture it had AT the due date. That passes
  // Q9/Q11 with ~6% margins and lowers flat-0's day-before capture from 0.51 to 0.31.
  const pressure = lerp(URGENCY_CURVE, d) * Math.max(slip, floor);
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

/** The bucket an importance value falls in (5 significant digits); non-finite → 0. */
export function importanceBucket(v: number): number {
  return Number.isFinite(v) ? Number(v.toPrecision(TIE_SIGNIFICANT_DIGITS)) : 0;
}

/** THE tie rule: importance values in the same 5-significant-digit bucket. */
export function sameImportance(a: number, b: number): boolean {
  return importanceBucket(a) === importanceBucket(b);
}

/** Higher bucket first; 0 only when the buckets are equal. */
function compareImportanceDesc(a: number, b: number): number {
  const ba = importanceBucket(a);
  const bb = importanceBucket(b);
  return ba === bb ? 0 : bb > ba ? 1 : -1;
}

/** THE zero-importance predicate: past due with nothing left to earn, unopened,
 *  passive, a study item whose time has passed, or a 0 share of grade. Such items
 *  stay listed at the bottom and never lead Focus. */
export function isZeroImportance(scored: { value?: number | null }): boolean {
  const v = scored.value ?? 0;
  return !(v > ZERO_IMPORTANCE); // NaN counts as zero
}

/** What the tiebreakers read. `share` = share of grade (0..1; raw points are not
 *  comparable across courses, so `points` only separates items of ONE course). */
export interface TieKey {
  canvasId: number;
  name: string;
  dueAtMs: number | null;
  share: number | null;
  courseGrade: number | null;
  courseName?: string;
  courseId?: number | null;
  points?: number | null;
}

const cmpNum = (a: number, b: number) => (a === b ? 0 : a < b ? -1 : 1);

/** Natural name order: "Prep 2" before "Prep 10". */
export function compareNames(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true });
}

/** THE tiebreak chain, used once importance is tied (owner, 2026-09-28). A strict
 *  lexicographic order — every step answers a definite sign, 0 only on true
 *  equality — so the result never depends on input order:
 *   1. due date: earlier first; dated before undated;
 *   2. share of grade: bigger first (5-significant-digit buckets);
 *   3. course grade: lower first, unknown after known;
 *   4. course (natural name, then id) — groups tied items by course so that
 *   5. raw points: higher first — only ever compared WITHIN one course (a 100-pt
 *      essay before 0-pt busywork when a thin course gives both the same share);
 *   6. natural item name ("Prep 2" before "Prep 10");
 *   7. canvasId.
 *  (Step 4 is what keeps a same-course-only points step transitive: without it,
 *  A<B by points, B<C by name, C<A by name could cycle.) */
export function compareTiebreak(a: TieKey, b: TieKey): number {
  if (a.dueAtMs != null || b.dueAtMs != null) {
    if (a.dueAtMs == null) return 1; // undated after dated
    if (b.dueAtMs == null) return -1;
    const c = cmpNum(a.dueAtMs, b.dueAtMs);
    if (c !== 0) return c;
  }
  const sc = compareImportanceDesc(a.share ?? 0, b.share ?? 0);
  if (sc !== 0) return sc;
  if (a.courseGrade != null || b.courseGrade != null) {
    if (a.courseGrade == null) return 1; // unknown grade after known
    if (b.courseGrade == null) return -1;
    const c = cmpNum(a.courseGrade, b.courseGrade);
    if (c !== 0) return c;
  }
  const cc = compareNames(a.courseName ?? "", b.courseName ?? "") || cmpNum(a.courseId ?? -1, b.courseId ?? -1);
  if (cc !== 0) return cc;
  const pc = cmpNum(b.points ?? -1, a.points ?? -1); // same course here → higher points first
  if (pc !== 0) return pc;
  return compareNames(a.name, b.name) || cmpNum(a.canvasId, b.canvasId);
}

/** Rank items by IMPORTANCE — the marginal grade-% at stake (`value`), highest
 *  first:
 *   1. ZERO-importance items (dead past-due, unopened, passive) sink to the very
 *      bottom — below even undated work — ordered among themselves by the
 *      tiebreakers only. They stay listed.
 *   2. Among non-zero items, **dated work comes first** (Calvin): undated work is
 *      backfill, even when it's a big slice of the grade.
 *   3. Then `value`, tied at 5 significant digits → `compareTiebreak`.
 *  (Per-hour ROI — `score` — is for the scheduler's slack split, not the importance
 *  rank: a 5-minute discussion is a quick win, not a high-importance item.) */
export function rankItems(items: MarginalInput[]): MarginalScore[] {
  const scored = items.map((i) => {
    const s = scoreItem(i);
    const zero = isZeroImportance(s);
    const dueAtMs = i.dueAtMs !== undefined ? i.dueAtMs : i.dueInDays === null ? null : i.dueInDays * 86_400_000;
    const key: TieKey = {
      canvasId: i.canvasId,
      name: i.name,
      dueAtMs: i.dueInDays === null ? null : dueAtMs,
      share: i.weight,
      courseGrade: i.courseGrade,
      courseName: i.courseName,
      courseId: i.courseId ?? null,
      points: i.points ?? null,
    };
    return { s, undated: i.dueInDays === null, zero, key };
  });
  // Lexicographic: (zero last) → (non-zero: dated first → importance bucket) → tiebreak chain.
  scored.sort((a, b) => {
    if (a.zero !== b.zero) return a.zero ? 1 : -1;
    if (!a.zero) {
      if (a.undated !== b.undated) return a.undated ? 1 : -1;
      const c = compareImportanceDesc(a.s.value, b.s.value);
      if (c !== 0) return c;
    }
    return compareTiebreak(a.key, b.key);
  });
  return scored.map((x) => (x.zero ? { ...x.s, value: 0, score: 0 } : x.s));
}
