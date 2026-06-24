// Convert raw Canvas points into each assignment's SHARE OF ITS COURSE GRADE — a
// fraction 0..1 — so work in different courses (with different point totals and
// different grading schemes) is comparable. This is the `weight` the prioritizer
// needs, and it's why points must be normalized PER COURSE before anything is
// compared across classes (Calvin's constraint: course totals differ).
//
// Two Canvas grading schemes, both handled from one `assignment_groups` fetch:
//  • Weighted groups: each group has a group_weight (% of the grade); an item's
//    share = (group's share of grade) × (its points / its group's total points).
//  • Points-based (no weights): share = its points / the course's total points.
// Pure; fails SAFE — when a share can't be determined it's null and the caller
// falls back to a type proxy (see TYPE_PROXY_WEIGHT).

import type { ItemType } from "./itemType";

export interface GroupForWeight {
  id: number;
  /** Canvas `group_weight`: a percent (e.g. 25 for 25%). 0/null in points-based courses. */
  groupWeight: number | null;
  assignments: { canvasId: number; pointsPossible: number | null }[];
}

export interface AssignmentWeight {
  canvasId: number;
  /** Share of the final course grade, 0..1; null = indeterminate (use a proxy). */
  gradeWeight: number | null;
}

const num = (n: number | null | undefined): number => (Number.isFinite(n as number) ? (n as number) : 0);

/**
 * Compute every assignment's share of its course's final grade from the course's
 * assignment groups. A course either uses weighted groups (any group_weight > 0)
 * or plain points — detected automatically.
 */
export function computeGradeWeights(groups: GroupForWeight[]): AssignmentWeight[] {
  const out: AssignmentWeight[] = [];
  const usesWeights = groups.some((g) => num(g.groupWeight) > 0);

  if (usesWeights) {
    // Group weights needn't sum to 100 (Canvas allows it) — normalize so the
    // course's grade shares always total 1.
    const totalW = groups.reduce((s, g) => s + Math.max(0, num(g.groupWeight)), 0);
    for (const g of groups) {
      const groupShare = totalW > 0 ? Math.max(0, num(g.groupWeight)) / totalW : 0;
      const groupPoints = g.assignments.reduce((s, a) => s + num(a.pointsPossible), 0);
      for (const a of g.assignments) {
        // Split the group's grade-share across its assignments by points; if the
        // group has no points yet, split evenly so its weight isn't lost.
        const within =
          groupPoints > 0
            ? num(a.pointsPossible) / groupPoints
            : g.assignments.length > 0
              ? 1 / g.assignments.length
              : 0;
        out.push({ canvasId: a.canvasId, gradeWeight: groupShare * within });
      }
    }
    return out;
  }

  // Points-based: share = points / total course points.
  const total = groups.reduce(
    (s, g) => s + g.assignments.reduce((t, a) => t + num(a.pointsPossible), 0),
    0,
  );
  for (const g of groups) {
    for (const a of g.assignments) {
      out.push({
        canvasId: a.canvasId,
        gradeWeight: total > 0 ? num(a.pointsPossible) / total : null,
      });
    }
  }
  return out;
}

/** Type-based fallback share-of-grade, used ONLY when groups/points are missing.
 *  An exam is typically a far bigger slice of the grade than a discussion. */
export const TYPE_PROXY_WEIGHT: Record<ItemType, number> = {
  exam: 0.25,
  quiz: 0.08,
  assignment: 0.06,
  other: 0.03,
};

/** Resolve the weight to feed the prioritizer: the computed share when it's KNOWN —
 *  including an explicit 0, which means the group/item genuinely doesn't count toward
 *  the grade (→ correctly low priority, NOT the proxy). Falls back to the type proxy
 *  only for a missing/indeterminate (null/undefined/NaN/negative) share. Always 0..1. */
export function resolveWeight(computed: number | null | undefined, type: ItemType): number {
  if (computed != null && Number.isFinite(computed) && computed >= 0) return Math.min(1, computed);
  return TYPE_PROXY_WEIGHT[type];
}
