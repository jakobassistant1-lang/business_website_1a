// Grade calculator — turns a course's graded + remaining work into the answers
// Canvas hides: the current weighted grade, a what-if projection, and the score
// you'd need on remaining work to hit a target. Pure + unit-tested (no I/O).
//
// Two modes, auto-selected from the data:
//  - "weighted": assignment-group weights are present (Canvas `group_weight`).
//    A group's score is points-based (Σ earned / Σ possible in the group, like
//    Canvas), and the course grade = Σ(weight × groupScore) normalized over the
//    groups that have any counted work — mirroring Canvas's weighted total.
//  - "points": no weights → grade = Σ earned / Σ possible across everything.
//
// We never replace Canvas's official number when it exists; this projects the
// *remaining* picture and what-ifs. The UI labels any projection as an estimate.

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

/** Current grade from graded work only (what-ifs excluded). Null = nothing graded. */
export function currentGrade(items: GradeInput[], mode: GradeMode = gradeMode(items)): number | null {
  return projectGrade(items, EMPTY, mode);
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
