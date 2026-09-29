// Convert raw Canvas points into each assignment's SHARE OF ITS COURSE GRADE — a
// fraction 0..1 — so work in different courses (with different point totals and
// different grading schemes) is comparable. This is the `weight` the prioritizer
// needs, and it's why points must be normalized PER COURSE before anything is
// compared across classes (Calvin's constraint: course totals differ).
//
// THE ONE share rule is `gradeShareFor` (#144, owner's order): (1) course info —
// Canvas weighted groups, then the syllabus's categories / point total — (2) the
// share of the points posted so far, ONLY once the course has THIN_COURSE_MIN_ITEMS
// pointed items posted, (3) the type default. `courseGradeShares` applies it to a
// whole course (sync writes the result to Assignment.gradeWeight).
//
// Two Canvas grading schemes, both handled from one `assignment_groups` fetch:
//  • Weighted groups: each group has a group_weight (% of the grade); an item's
//    share = (group's share of grade) × (its points / its group's total points).
//  • Points-based (no weights): share = its points / the course's total points.
// Pure; fails SAFE.

import type { ItemType } from "./itemType";
import { matchCategory, type GradingCategory, type GradingScheme } from "./gradingScheme";

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

/** Does the course grade by weighted assignment groups (any group_weight > 0)? */
export function usesGroupWeights(groups: Pick<GroupForWeight, "groupWeight">[]): boolean {
  return groups.some((g) => num(g.groupWeight) > 0);
}

/**
 * Compute every assignment's share of its course's final grade from the course's
 * assignment groups. A course either uses weighted groups (any group_weight > 0)
 * or plain points — detected automatically.
 */
export function computeGradeWeights(groups: GroupForWeight[]): AssignmentWeight[] {
  const out: AssignmentWeight[] = [];
  const usesWeights = usesGroupWeights(groups);

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

/** Type-based fallback share-of-grade, used ONLY when nothing better is known.
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

// --- #144: THE grade-share rule ------------------------------------------------

/** "Thin course" rule (approved): the share of points POSTED so far is used only
 *  once a course has at least this many pointed items posted. Managerial
 *  Economics had ONE 100-pt item posted and it counted as 100% of the grade. */
export const THIN_COURSE_MIN_ITEMS = 5;

export type GradeShareSource = "canvas_groups" | "syllabus_categories" | "syllabus_total" | "posted_points" | "default";

export interface GradeShareInput {
  /** Canvas weighted groups (computeGradeWeights on a weighted course); null otherwise. */
  canvasWeightedShare: number | null;
  scheme: GradingScheme | null;
  /** The syllabus category the item matched (matchCategory) + how many of the
   *  course's posted pointed items matched it. */
  category: { weight: number; count?: number; postedInCategory: number } | null;
  /** For an item that matched NO category in a course where others did: the
   *  grade the syllabus categories leave unclaimed (1 − Σ category weights) and
   *  Σ points of the posted items sharing it. Null/absent → not applicable. */
  unclaimed?: { weight: number; points: number } | null;
  points: number | null;
  /** Σ points over the course's posted items with points > 0. */
  postedTotalPoints: number;
  /** How many of the course's posted items have points > 0. */
  postedPointedCount: number;
  type: ItemType;
}

export interface GradeShare {
  share: number; // 0..1
  source: GradeShareSource;
}

const known = (n: number | null | undefined): n is number => n != null && Number.isFinite(n) && n >= 0;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * One assignment's share of its course grade, 0..1, in the owner's order:
 *  1. Canvas weighted groups (course info straight from Canvas);
 *  2. syllabus categories — weight ÷ max(syllabus count, items posted in the
 *     category), so items not posted yet keep their slice (Homework 20% / 10
 *     items → 0.02 each even when only 2 are posted); an item with no points or
 *     0 points gets 0. An item matching NO category shares the UNCLAIMED
 *     remainder (1 − Σ category weights) with the other unmatched items, by
 *     points; when that remainder is below its type default it falls through to
 *     steps 3–5 instead (a graded item never gets 0 for an unmatched name);
 *  3. syllabus point total — points ÷ max(totalPoints, points posted), so a
 *     stated total below what's already posted can't push the sum past 1;
 *  4. posted points — points ÷ posted total, ONLY with ≥ THIN_COURSE_MIN_ITEMS
 *     pointed items posted;
 *  5. the type default (TYPE_PROXY_WEIGHT).
 */
export function gradeShareFor(input: GradeShareInput): GradeShare {
  const { canvasWeightedShare, scheme, category, unclaimed, points, postedTotalPoints, postedPointedCount, type } = input;

  if (known(canvasWeightedShare)) return { share: clamp01(canvasWeightedShare), source: "canvas_groups" };

  if (category && known(category.weight)) {
    if (!known(points) || points === 0) return { share: 0, source: "syllabus_categories" };
    const denom = Math.max(1, num(category.count), num(category.postedInCategory));
    return { share: clamp01(category.weight / denom), source: "syllabus_categories" };
  }

  // Unmatched item: split the unclaimed remainder by points — but a graded item
  // NEVER gets 0 just because its name matched no category. When the remainder is
  // smaller than its type default (e.g. categories already sum to 100%) it falls
  // through to steps 3–5 for THIS item; courseGradeShares' cap then keeps Σ ≤ 1.
  if (unclaimed && known(unclaimed.weight)) {
    if (!known(points) || points === 0) return { share: 0, source: "syllabus_categories" };
    const remainder = clamp01(unclaimed.weight);
    if (remainder >= TYPE_PROXY_WEIGHT[type]) {
      const pool = Math.max(num(unclaimed.points), points);
      return { share: clamp01((remainder * points) / pool), source: "syllabus_categories" };
    }
  }

  const total = scheme?.totalPoints;
  if (known(points) && total != null && Number.isFinite(total) && total > 0) {
    return { share: clamp01(points / Math.max(total, num(postedTotalPoints))), source: "syllabus_total" };
  }

  if (known(points) && postedPointedCount >= THIN_COURSE_MIN_ITEMS && postedTotalPoints > 0) {
    return { share: clamp01(points / postedTotalPoints), source: "posted_points" };
  }

  // An item explicitly worth ZERO points counts for nothing in a points course — it
  // must not tie a 100-point essay through the type default. Unknown points (null)
  // still get the default: "not stated" is not "worth nothing".
  if (points === 0) return { share: 0, source: "default" };
  return { share: TYPE_PROXY_WEIGHT[type], source: "default" };
}

/** Keep a course's shares summing to ≤ 1 (see courseGradeShares): when over,
 *  EVERY share is scaled by the same factor — proportional, so no positive share
 *  is squeezed to 0 and the course's internal order is kept. */
function capCourseShares(shares: Map<number, GradeShare>): Map<number, GradeShare> {
  const all = [...shares.values()];
  const total = all.reduce((s, x) => s + x.share, 0);
  if (total > 1) for (const x of all) x.share /= total;
  return shares;
}

export interface ShareItem {
  canvasId: number;
  name: string;
  points: number | null;
  groupName: string | null;
  type: ItemType;
}

/**
 * `gradeShareFor` over one course's posted items: works out the posted totals,
 * matches each item to a syllabus category and counts the pointed items per
 * category. `canvasWeighted` = computeGradeWeights for a WEIGHTED-group course
 * (null for a points-based one — its points split is step 4, gated by the thin
 * course rule).
 *
 * The course's shares never sum past 1: if they would (type defaults on a course
 * whose items carry no points, unmatched items that fell through past a full
 * set of syllabus categories, or an odd mix), every share is scaled down by the
 * same factor — a positive share never becomes 0.
 */
export function courseGradeShares(
  items: ShareItem[],
  ctx: { canvasWeighted: Map<number, number | null> | null; scheme: GradingScheme | null },
): Map<number, GradeShare> {
  const pointed = items.filter((i) => known(i.points) && i.points > 0);
  const postedTotalPoints = pointed.reduce((s, i) => s + (i.points as number), 0);
  const matched = new Map<number, GradingCategory | null>();
  const perCategory = new Map<GradingCategory, number>();
  for (const i of items) {
    const cat = matchCategory(ctx.scheme, { groupName: i.groupName, name: i.name, type: i.type });
    matched.set(i.canvasId, cat);
    if (cat && known(i.points) && i.points > 0) perCategory.set(cat, (perCategory.get(cat) ?? 0) + 1);
  }
  // Unclaimed remainder: only when the syllabus categories actually describe this
  // course (at least one item matched one); otherwise the later steps apply.
  const cats = ctx.scheme?.categories ?? [];
  const anyMatched = [...matched.values()].some((c) => c != null);
  const unclaimedPoints = pointed.filter((i) => matched.get(i.canvasId) == null).reduce((s, i) => s + (i.points as number), 0);
  const unclaimed = anyMatched ? { weight: Math.max(0, 1 - cats.reduce((s, c) => s + c.weight, 0)), points: unclaimedPoints } : null;

  const out = new Map<number, GradeShare>();
  for (const i of items) {
    const cat = matched.get(i.canvasId) ?? null;
    out.set(
      i.canvasId,
      gradeShareFor({
        canvasWeightedShare: ctx.canvasWeighted?.get(i.canvasId) ?? null,
        scheme: ctx.scheme,
        category: cat ? { weight: cat.weight, count: cat.count, postedInCategory: perCategory.get(cat) ?? 0 } : null,
        unclaimed: cat ? null : unclaimed,
        points: i.points,
        postedTotalPoints,
        postedPointedCount: pointed.length,
        type: i.type,
      }),
    );
  }
  return capCourseShares(out);
}
