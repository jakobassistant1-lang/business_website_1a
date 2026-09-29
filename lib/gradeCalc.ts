// Grade calculator — turns a course's graded + remaining work into the answers
// Canvas hides: a what-if projection, an estimate from graded work, and the score
// you'd need on remaining work to hit a target. Pure + unit-tested (no I/O).
//
// Two modes, auto-selected from the data:
//  - "weighted": assignment-group weights are present (Canvas `group_weight`).
//    A group's score is points-based (Σ earned / Σ possible in the group, like
//    Canvas), and the course grade = Σ(weight × groupScore) normalized over the
//    groups that have any counted work — mirroring Canvas's weighted total.
//  - "points": no weights → grade = Σ earned / Σ possible across everything.
//
// GRADE CANON (owner, 2026-09-28): "Current grade" is ALWAYS Canvas's own number
// and letter (CourseGrade from lib/courseGrade — what GradePill shows). This module
// never produces a "current grade": its graded-work figure is only ever shown as
// "Estimated from your graded work" (when the teacher hides the total) and its
// projections only under "What-if". `gradeHeadline` is the one place that decides
// which of those the Grades tab leads with. No second letter scale here.

import { gradePercentText, type CourseGrade } from "./courseGrade";

export interface GradeInput {
  canvasId: number;
  name: string;
  pointsPossible: number; // must be > 0 to count toward the grade
  score: number | null; // raw points earned; null = not graded yet (= "remaining")
  groupId: number | null; // Canvas assignment_group id (null = ungrouped)
  groupName: string | null;
  groupWeight: number | null; // Canvas group_weight as a percent; null/0 = unweighted
}

export type GradeMode = "weighted" | "points";

export interface CategoryBreakdown {
  groupId: number | null;
  name: string;
  weight: number | null; // null in points mode
  average: number | null; // 0–100 over graded work only; null = nothing graded yet
  gradedCount: number;
  remainingCount: number;
}

export type NeededResult =
  | { kind: "secured" } // graded work already guarantees the target (0 needed)
  | { kind: "score"; value: number } // min uniform % needed on every remaining item
  | { kind: "impossible" }; // even 100% on everything left can't reach the target

/** Only assignments worth points count toward a grade. */
function gradeable(items: GradeInput[]): GradeInput[] {
  return items.filter((i) => i.pointsPossible > 0);
}

export function gradeMode(items: GradeInput[]): GradeMode {
  return gradeable(items).some((i) => i.groupWeight != null && i.groupWeight > 0) ? "weighted" : "points";
}

type Bucket = { weight: number; earned: number; possible: number };

/**
 * Core: roll the counted items up into a course percentage.
 * An item is "counted" if it's graded (real score) OR present in `assume`
 * (a what-if percent, 0–100). Uncounted items are ignored, so this doubles as
 * the *current* grade when `assume` is empty.
 */
export function projectGrade(items: GradeInput[], assume: Map<number, number>, mode: GradeMode = gradeMode(items)): number | null {
  const buckets = new Map<number, Bucket>();
  for (const it of gradeable(items)) {
    let earned: number;
    if (it.score != null) earned = it.score;
    else if (assume.has(it.canvasId)) earned = (clampPct(assume.get(it.canvasId)!) / 100) * it.pointsPossible;
    else continue; // not graded and no what-if → doesn't count yet

    const key = mode === "weighted" ? it.groupId ?? -1 : 0;
    const b = buckets.get(key) ?? { weight: mode === "weighted" ? it.groupWeight ?? 0 : 0, earned: 0, possible: 0 };
    b.earned += earned;
    b.possible += it.pointsPossible;
    buckets.set(key, b);
  }

  if (mode === "weighted") {
    let num = 0;
    let den = 0;
    for (const b of buckets.values()) {
      if (b.possible > 0 && b.weight > 0) {
        num += b.weight * ((b.earned / b.possible) * 100);
        den += b.weight;
      }
    }
    return den > 0 ? num / den : null;
  }
  // points mode: one combined bucket
  let earned = 0;
  let possible = 0;
  for (const b of buckets.values()) {
    earned += b.earned;
    possible += b.possible;
  }
  return possible > 0 ? (earned / possible) * 100 : null;
}

/** This calculator's figure from graded work only (what-ifs excluded). Null =
 *  nothing graded. NOT the course's current grade — that is Canvas's number; see
 *  `gradeHeadline` for how (and whether) this may be shown. */
export function gradedWorkEstimate(items: GradeInput[], mode: GradeMode = gradeMode(items)): number | null {
  return projectGrade(items, EMPTY, mode);
}
/** @deprecated name kept for existing callers/tests — use `gradedWorkEstimate`. */
export const currentGrade = gradedWorkEstimate;

/** What the Grades tab leads with. */
export interface GradeHeadline {
  /** "Current grade" (Canvas's number) or "Estimated from your graded work". */
  label: "Current grade" | "Estimated from your graded work";
  /** "88%", or "—" when there is nothing to show. */
  value: string;
  /** Canvas's letter — only ever Canvas's, never computed here. */
  letter: string | null;
  /** One short line under the number. */
  note: string;
  /** The number the what-if starts from (null = nothing to start from). */
  start: number | null;
}

/** THE rule for the Grades tab's headline number:
 *   - Canvas has a total → "Current grade" = Canvas's number + Canvas's letter.
 *   - No Canvas total but graded work exists (teacher hides totals, or Canvas hasn't
 *     computed one) → "Estimated from your graded work" = this calculator's figure,
 *     no letter.
 *   - Nothing graded → "Current grade" "—" · "No grades yet". */
export function gradeHeadline(official: CourseGrade | undefined, estimate: number | null): GradeHeadline {
  if (official?.state === "graded" && official.score != null) {
    return { label: "Current grade", value: gradePercentText(official.score), letter: official.letter, note: "From Canvas", start: official.score };
  }
  if (estimate != null) {
    const note = official?.state === "hidden" ? "Your teacher hides the course total in Canvas" : "Canvas hasn’t shown a course total yet";
    return { label: "Estimated from your graded work", value: gradePercentText(estimate), letter: null, note, start: estimate };
  }
  return { label: "Current grade", value: "—", letter: null, note: "No grades yet", start: null };
}

/**
 * Minimum uniform score (0–100) you'd need on EVERY remaining gradeable item to
 * finish at `target`. Monotonic in that score, so a fine sweep finds the floor;
 * we round up so hitting the number truly suffices.
 */
export function neededUniformScore(items: GradeInput[], target: number, mode: GradeMode = gradeMode(items)): NeededResult {
  const remaining = gradeable(items).filter((i) => i.score == null);
  if (remaining.length === 0) {
    const cur = currentGrade(items, mode);
    return cur != null && cur >= target ? { kind: "secured" } : { kind: "impossible" };
  }
  const projAt = (x: number) => projectGrade(items, new Map(remaining.map((r) => [r.canvasId, x])), mode) ?? 0;
  if (projAt(0) >= target) return { kind: "secured" };
  if (projAt(100) < target) return { kind: "impossible" };
  for (let x = 0; x <= 100; x += 0.5) {
    if (projAt(x) >= target) return { kind: "score", value: Math.ceil(x) };
  }
  return { kind: "impossible" };
}

/** The what-if ANCHOR: Canvas's current grade minus this calculator's estimate of
 *  it. Our math can't see dropped scores, extra credit or excused work, so every
 *  what-if figure is shifted by this gap — with nothing changed, the what-if reads
 *  exactly Canvas's number. 0 when Canvas shows no total (the headline is then our
 *  own "Estimated from your graded work", so there's nothing to line up with). */
export function whatIfOffset(official: CourseGrade | undefined, estimate: number | null): number {
  if (official?.state !== "graded" || official.score == null || estimate == null) return 0;
  return official.score - estimate;
}

/** "Keep it up" what-if scores: each remaining item at its category's current
 *  graded average (weighted mode) or at the overall estimate (points mode, or a
 *  category with nothing graded yet). Projecting with these reproduces the current
 *  estimate exactly, so — with the anchor — the untouched what-if equals Canvas's
 *  number. Empty when nothing is graded yet. */
export function keepUpScores(items: GradeInput[], mode: GradeMode = gradeMode(items)): Map<number, number> {
  const est = gradedWorkEstimate(items, mode);
  if (est == null) return new Map();
  const avgByGroup = new Map<number | null, number | null>();
  if (mode === "weighted") for (const c of categoryBreakdown(items)) avgByGroup.set(c.groupId, c.average);
  const out = new Map<number, number>();
  for (const it of gradeable(items)) {
    if (it.score != null) continue;
    const groupKey = it.groupId ?? null;
    const avg = mode === "weighted" ? avgByGroup.get(groupKey) ?? null : null;
    out.set(it.canvasId, avg ?? est);
  }
  return out;
}

/** The anchored what-if: the projection with `assume`, shifted by `offset`. */
export function anchoredProjection(items: GradeInput[], assume: Map<number, number>, offset: number): number | null {
  const p = projectGrade(items, assume);
  return p == null ? null : Math.max(0, p + offset);
}

/** "What do I need" on the same anchored scale: the target is moved by the anchor
 *  before solving, so the answer agrees with the anchored projection. */
export function anchoredNeeded(items: GradeInput[], target: number, offset: number): NeededResult {
  return neededUniformScore(items, target - offset);
}

/** Per-category averages (graded work only) for the weighted-breakdown UI. */
export function categoryBreakdown(items: GradeInput[]): CategoryBreakdown[] {
  const mode = gradeMode(items);
  const groups = new Map<number, { name: string; weight: number | null; earned: number; possible: number; graded: number; remaining: number }>();
  for (const it of gradeable(items)) {
    const key = mode === "weighted" ? it.groupId ?? -1 : 0;
    const g = groups.get(key) ?? { name: mode === "weighted" ? it.groupName ?? "Other" : "Overall", weight: mode === "weighted" ? it.groupWeight ?? null : null, earned: 0, possible: 0, graded: 0, remaining: 0 };
    if (it.score != null) {
      g.earned += it.score;
      g.possible += it.pointsPossible;
      g.graded += 1;
    } else {
      g.remaining += 1;
    }
    groups.set(key, g);
  }
  return [...groups.entries()].map(([id, g]) => ({
    groupId: id === 0 || id === -1 ? null : id,
    name: g.name,
    weight: g.weight,
    average: g.possible > 0 ? (g.earned / g.possible) * 100 : null,
    gradedCount: g.graded,
    remainingCount: g.remaining,
  }));
}

const EMPTY = new Map<number, number>();

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}
