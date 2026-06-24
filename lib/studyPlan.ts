// Study/work session expansion — the pure core of the v1 scheduler
// (docs/navo-scheduling-v1-spec.md).
//
// Turns ONE assessment (exam/quiz) into a spaced sequence of ≤1h study sessions
// (bell-sized, review-then-relearn), and ONE deliverable into ≤1h work blocks.
// Pure + deterministic; the placement onto actual calendar days (budget, EDF,
// contention) happens in lib/scheduler.ts. Constants here are the spec's knobs.

import { round1 } from "./round";
import type { ItemType } from "./itemType";

export type AssessmentTier = "quiz" | "exam" | "final";
export type SessionKind = "review" | "relearn";

// --- tunable constants (spec §13) ---
export const INFLATION = 1.2; // planning-fallacy correction on every estimate (spec §6)
export const DAILY_HEADROOM = 0.9; // schedule to 90% of the daily budget (spec §6)
export const MAX_BLOCK = 1.0; // hours — the per-SESSION cap (not per-day) (spec §4)
export const MAX_SESSIONS = 12; // backstop for very heavy loads
const TARGET_AVG = 0.85; // aim for ~0.85h average session → sets the session count
const END_RATIO = 0.55; // bell ends sit at ~55% of the peak (gentle hump, not a sharp normal)
const DAY_BEFORE_TAPER = 0.85; // the final (day-before) review is a touch lighter still

export const LEAD_CAP: Record<AssessmentTier, number> = { quiz: 3, exam: 7, final: 14 };
export const TYPE_MIN_SESSIONS: Record<AssessmentTier, number> = { quiz: 2, exam: 3, final: 4 };

export const inflate = (hours: number): number => Math.max(0, hours) * INFLATION;

/** Classify an assessment into its study tier. Midterms/finals/cumulative exams
 *  get the long (14-day) lead; other exams 7; quizzes 3. */
export function assessmentTier(type: ItemType, name: string): AssessmentTier {
  if (type === "quiz") return "quiz";
  if (/\b(final|midterm|cumulative)\b/i.test(name ?? "")) return "final";
  return "exam"; // type === "exam"
}

/** Days available to study before the assessment: ≥1, and no more than the lead
 *  window. The lead window is the user's `leadDays` when set (per-assignment override
 *  or their studyDaysQuiz/Test/Final setting), otherwise the tier default LEAD_CAP. */
export function effectiveWindow(daysUntil: number, tier: AssessmentTier, leadDays?: number | null): number {
  const cap = leadDays != null && leadDays > 0 ? Math.floor(leadDays) : LEAD_CAP[tier];
  return Math.max(1, Math.min(Math.floor(daysUntil), cap));
}

/** How many ≤1h sessions to cover H hours: ~0.85h each, at least the type
 *  minimum, at most 2/day across the window (and a hard backstop). */
export function sessionCount(hInflated: number, tier: AssessmentTier, L: number): number {
  const hardCap = Math.min(MAX_SESSIONS, Math.max(1, 2 * L)); // ≤2 sessions/day across the window
  let n = Math.round(hInflated / TARGET_AVG);
  n = Math.max(n, TYPE_MIN_SESSIONS[tier]);
  n = Math.min(n, hardCap);
  return Math.max(1, n);
}

/** Gentle bell weights (sum 1): light first, peak middle, lightest last. */
export function bellWeights(n: number): number[] {
  if (n <= 1) return [1];
  const center = (n - 1) / 2;
  const w: number[] = [];
  for (let i = 0; i < n; i++) {
    const d = center === 0 ? 0 : (i - center) / center; // -1..1
    w.push(1 - (1 - END_RATIO) * d * d); // parabola: 1 at center, END_RATIO at the ends
  }
  w[n - 1] *= DAY_BEFORE_TAPER;
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / sum);
}

/** Day-before offsets (1 = day before the assessment) for N sessions over an
 *  L-day window: session 1 earliest (offset L), session N on day −1. When N > L,
 *  offsets repeat → two sessions land on a day (the spec's "double up when the
 *  load forces it"). */
export function sessionDayOffsets(n: number, L: number): number[] {
  if (n <= 1) return [1];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.max(1, Math.round(L - (i * (L - 1)) / (n - 1))));
  return out;
}

/** Spread H across the weights, capping each at MAX_BLOCK and redistributing any
 *  clipped excess onto sessions with headroom (so the total is preserved until
 *  the window is genuinely too small). */
function distribute(h: number, weights: number[]): number[] {
  let sizes = weights.map((w) => w * h);
  for (let iter = 0; iter < 6; iter++) {
    const excess = sizes.reduce((s, x) => s + Math.max(0, x - MAX_BLOCK), 0);
    if (excess < 1e-6) break;
    sizes = sizes.map((x) => Math.min(x, MAX_BLOCK));
    const room = sizes.map((x) => MAX_BLOCK - x);
    const totalRoom = room.reduce((a, b) => a + b, 0);
    if (totalRoom < 1e-6) break; // genuinely over capacity → caller surfaces it
    sizes = sizes.map((x, i) => x + (excess * room[i]) / totalRoom);
  }
  return sizes.map((x) => Math.min(x, MAX_BLOCK));
}

export interface StudySession {
  index: number; // 1..N order (1 = earliest)
  dayOffset: number; // days before the assessment (1 = the day before)
  hours: number; // ≤ MAX_BLOCK
  kind: SessionKind; // session 1 = review/re-read; the rest = successive relearning
}

export interface AssessmentPlan {
  tier: AssessmentTier;
  window: number; // effective lead window (days)
  sessions: StudySession[];
  overflowHours: number; // study time that couldn't fit ≤1h sessions in the window (>0 ⇒ over capacity)
}

/** Expand an assessment into its ideal spaced study sessions (spec §4). `leadDays`
 *  (optional) is the user's study-lead override/setting; it sets the window. */
export function expandAssessment(input: {
  daysUntil: number;
  studyHours: number;
  tier: AssessmentTier;
  leadDays?: number | null;
}): AssessmentPlan {
  const { tier } = input;
  const L = effectiveWindow(input.daysUntil, tier, input.leadDays);
  const H = inflate(input.studyHours);
  const n = sessionCount(H, tier, L);
  const weights = bellWeights(n);
  const offsets = sessionDayOffsets(n, L);
  const sizes = distribute(H, weights);
  // Drop sessions that round to 0h: a 0h session is negligible time, and if it
  // reached the placer it would be "placed" but emit no block — silently erasing
  // the item. Re-index the survivors; the earliest survivor is the review.
  const sessions: StudySession[] = offsets
    .map((dayOffset, i) => ({ dayOffset, hours: round1(sizes[i]) }))
    .filter((s) => s.hours > 0)
    .map((s, i) => ({ index: i + 1, dayOffset: s.dayOffset, hours: s.hours, kind: i === 0 ? "review" : "relearn" }));
  const placed = sessions.reduce((s, x) => s + x.hours, 0);
  return { tier, window: L, sessions, overflowHours: round1(Math.max(0, round1(H) - placed)) };
}

export interface DeliverableBlock {
  hours: number; // ≤ MAX_BLOCK
  index: number; // 1..n
  count: number; // n (total blocks)
}

/** Split a deliverable into ≤1h work blocks (spec §5). ≤1h ⇒ one block; larger
 *  ⇒ even ≤1h chunks. (If placement can't spread them across enough days, it
 *  merges + adds a break reminder — that's a scheduler concern, not here.) */
export function chunkDeliverable(input: { effortHours: number }): DeliverableBlock[] {
  const H = inflate(input.effortHours);
  if (round1(H) <= 0) return []; // ~0 effort → no block (the item still gets its G1 marker)
  if (H <= MAX_BLOCK) return [{ hours: round1(H), index: 1, count: 1 }];
  const n = Math.ceil(H / MAX_BLOCK);
  const each = round1(H / n);
  return Array.from({ length: n }, (_, i) => ({ hours: each, index: i + 1, count: n }));
}
