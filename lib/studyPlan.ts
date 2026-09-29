// Study/work session expansion — the pure core of the v1 scheduler
// (docs/navo-scheduling-v1-spec.md).
//
// Turns ONE assessment (exam/quiz) into a spaced sequence of ≤1h study sessions
// (bell-sized, review-then-relearn), and ONE deliverable into ≤1h work blocks.
// Pure + deterministic; the placement onto actual calendar days (budget, EDF,
// contention) happens in lib/weekPlan.ts. Constants here are the spec's knobs.
//
// Hours arrive ALREADY padded (lib/effort.effectiveEffort pads an AI estimate once;
// a student's own number is used as typed) — nothing here inflates again (#136).
// Sizes are whole hundredths of an hour that sum exactly to the input, so an
// item's blocks add up to the effort its tag shows.

import type { ItemType } from "./itemType";
import { MIN_BLOCK } from "./effort";

export { MIN_BLOCK };

export type AssessmentTier = "quiz" | "exam" | "final";
export type SessionKind = "review" | "relearn";

// --- tunable constants (spec §13) ---
export const DAILY_HEADROOM = 0.9; // schedule to 90% of the daily budget (spec §6)
export const MAX_BLOCK = 1.0; // hours — the per-SESSION cap (not per-day) (spec §4)
export const MAX_SESSIONS = 12; // backstop for very heavy loads
// MIN_BLOCK (lib/effort): smaller slivers are folded into a sibling, never shown as 0m.
const TARGET_AVG = 0.85; // aim for ~0.85h average session → sets the session count
const END_RATIO = 0.55; // bell ends sit at ~55% of the peak (gentle hump, not a sharp normal)
const DAY_BEFORE_TAPER = 0.85; // the final (day-before) review is a touch lighter still

export const LEAD_CAP: Record<AssessmentTier, number> = { quiz: 3, exam: 7, final: 14 };
export const TYPE_MIN_SESSIONS: Record<AssessmentTier, number> = { quiz: 2, exam: 3, final: 4 };

const toCents = (h: number): number => Math.round(Math.max(0, h) * 100);
const MIN_CENTS = Math.round(MIN_BLOCK * 100);
const MAX_CENTS = Math.round(MAX_BLOCK * 100);

/** Whole-cent sizes (largest remainder) that sum exactly to round(Σsizes). */
function toCentSizes(sizes: number[]): number[] {
  const total = toCents(sizes.reduce((a, b) => a + b, 0));
  const floors = sizes.map((x) => Math.min(MAX_CENTS, Math.floor(Math.max(0, x) * 100 + 1e-9)));
  let rem = total - floors.reduce((a, b) => a + b, 0);
  const order = sizes
    .map((x, i) => ({ i, frac: Math.max(0, x) * 100 - floors[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rem > 0 && k < order.length * 2; k++) {
    const { i } = order[k % order.length];
    if (floors[i] < MAX_CENTS) {
      floors[i]++;
      rem--;
    }
  }
  return floors;
}

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
export function sessionCount(hours: number, tier: AssessmentTier, L: number): number {
  const hardCap = Math.min(MAX_SESSIONS, Math.max(1, 2 * L)); // ≤2 sessions/day across the window
  let n = Math.round(hours / TARGET_AVG);
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
  const H = Math.max(0, input.studyHours); // already padded — see the header note
  if (toCents(H) < MIN_CENTS) return { tier, window: L, sessions: [], overflowHours: 0 }; // ~0 effort → no sessions (the item gets its due-day marker)
  const n = sessionCount(H, tier, L);
  const weights = bellWeights(n);
  const offsets = sessionDayOffsets(n, L);
  const cents = toCentSizes(distribute(H, weights));
  // A sliver under MIN_BLOCK would print as "0m": fold it into the lightest other
  // session with room (total preserved), else it counts as overflow. Zero-size
  // sessions are dropped — a 0h session would be "placed" yet emit no block.
  for (let i = 0; i < cents.length; i++) {
    if (cents[i] === 0 || cents[i] >= MIN_CENTS) continue;
    let j = -1;
    for (let k = 0; k < cents.length; k++) {
      if (k === i || cents[k] === 0 || cents[k] + cents[i] > MAX_CENTS) continue;
      if (j < 0 || cents[k] < cents[j]) j = k;
    }
    if (j >= 0) cents[j] += cents[i];
    cents[i] = 0;
  }
  // Re-index the survivors; the earliest survivor is the review.
  const sessions: StudySession[] = offsets
    .map((dayOffset, i) => ({ dayOffset, c: cents[i] }))
    .filter((s) => s.c > 0)
    .map((s, i) => ({ index: i + 1, dayOffset: s.dayOffset, hours: s.c / 100, kind: i === 0 ? "review" : "relearn" }));
  const placedCents = sessions.reduce((sum, x) => sum + Math.round(x.hours * 100), 0);
  return { tier, window: L, sessions, overflowHours: Math.max(0, toCents(H) - placedCents) / 100 };
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
  const total = toCents(input.effortHours); // already padded — see the header note
  if (total < MIN_CENTS) return []; // ~0 effort → no block (the item still gets its due-day marker)
  const n = Math.ceil(total / MAX_CENTS);
  const base = Math.floor(total / n);
  const extra = total % n; // the first `extra` blocks carry one more hundredth → exact total
  return Array.from({ length: n }, (_, i) => ({ hours: (base + (i < extra ? 1 : 0)) / 100, index: i + 1, count: n }));
}
