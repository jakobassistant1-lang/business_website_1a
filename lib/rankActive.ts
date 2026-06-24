// Builds the user-facing importance ranking from synced assignment rows using the
// v1 marginal prioritizer (lib/marginalPriority + docs/navo-priority-v1-spec.md).
//
// Each item's raw points are first converted to its SHARE OF ITS COURSE GRADE —
// because course point-totals differ, raw points aren't comparable across classes
// (Calvin's constraint). For points-based courses that's points / course-total,
// computed from rows already in the DB; weighted-group `gradeWeight`, the current
// `courseGrade` (leverage), and `latePolicy` layer on once synced, and FAIL OPEN
// to the type proxy / neutral grade / no-credit until then.

import { rankItems, type MarginalInput } from "./marginalPriority";
import { DEFAULT_LATE_POLICY, type LatePolicy } from "./latePolicy";
import { resolveWeight } from "./gradeWeight";
import { itemType, isStudyType, requiresOnlineSubmission, type ItemType } from "./itemType";
import { round1 } from "./round";
import type { ScoredAssignment } from "./priority";

const DAY = 86_400_000;
function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function daysUntil(due: Date | null, now: Date): number | null {
  if (!due) return null;
  return Math.round((startOfDay(due).getTime() - startOfDay(now).getTime()) / DAY);
}

export interface RankableRow {
  canvasId: number;
  name: string;
  courseName: string;
  courseCanvasId: number;
  dueAt: Date | null;
  pointsPossible: number | null;
  htmlUrl: string | null;
  submissionType: string | null;
  estimatedEffortHours: number | null;
  type?: ItemType; // explicit classification (the demo has it); else derived from submissionType + name
  // Richer signals — optional; absent ⇒ fail open (see module header).
  courseGrade?: number | null; // current grade fraction 0..1
  latePolicy?: LatePolicy;
  gradeWeight?: number | null; // precomputed share of grade (weighted-group courses)
  requiresAction?: boolean | null; // false + no online submission ⇒ dropped from the ordering (AI screen)
}

const typeOf = (a: RankableRow): ItemType => a.type ?? itemType(a.submissionType, a.name);

function reasonFor(isStudy: boolean, d: number | null, points: number | null): string {
  const parts: string[] = [];
  if (d === null) parts.push(isStudy ? "No exam date" : "No due date");
  else if (isStudy) parts.push(d < 0 ? "Exam passed" : d === 0 ? "Exam today" : d === 1 ? "Exam tomorrow" : `Exam in ${d} days`);
  else parts.push(d < 0 ? "Overdue" : d === 0 ? "Due today" : d === 1 ? "Due in 1 day" : `Due in ${d} days`);
  if (points != null && points > 0) parts.push(`${points} pts`);
  return parts.join(" · ");
}

/** Σ points over ALL of a course's assignments (graded + not) — the denominator
 *  for the points-based grade share. Keyed by courseCanvasId. */
export function courseTotalPoints(allRows: { courseCanvasId: number; pointsPossible: number | null }[]): Map<number, number> {
  const totals = new Map<number, number>();
  for (const a of allRows) {
    if (a.pointsPossible != null && a.pointsPossible > 0) {
      totals.set(a.courseCanvasId, (totals.get(a.courseCanvasId) ?? 0) + a.pointsPossible);
    }
  }
  return totals;
}

/** Rank active coursework by marginal expected grade-% at stake (importance),
 *  highest first, in the `ScoredAssignment` shape the UI already consumes. */
export function rankActiveRows(
  active: RankableRow[],
  totals: Map<number, number>,
  defaultEffort: number,
  now: Date,
): ScoredAssignment[] {
  // AI screen: drop passive / non-actionable items (participation, attendance,
  // placeholder columns) the AI flagged. Two guardrails so we never drop real work:
  //   • NEVER drop an item with an online submission, and
  //   • NEVER drop an assessment (exam/quiz) — a no-submission in-person exam looks
  //     like a teacher-entered placeholder to the model, but you always study for it.
  // Readings (no submission, non-study) stay in via the AI's own requiresAction=true.
  const actionable = active.filter(
    (a) => !(a.requiresAction === false && !requiresOnlineSubmission(a.submissionType) && !isStudyType(typeOf(a))),
  );
  const inputs: MarginalInput[] = actionable.map((a) => {
    const type = typeOf(a);
    const isStudy = isStudyType(type);
    const total = totals.get(a.courseCanvasId) ?? 0;
    const pointsShare = total > 0 && a.pointsPossible != null ? a.pointsPossible / total : null;
    return {
      canvasId: a.canvasId,
      name: a.name,
      courseName: a.courseName,
      kind: isStudy ? "study" : "assignment",
      weight: resolveWeight(a.gradeWeight ?? pointsShare, type),
      courseGrade: a.courseGrade ?? null,
      dueInDays: daysUntil(a.dueAt, now),
      effortHours: a.estimatedEffortHours ?? defaultEffort,
      latePolicy: a.latePolicy ?? DEFAULT_LATE_POLICY,
      submitted: false,
    };
  });

  const ranked = rankItems(inputs);
  const topVal = ranked.length > 0 ? ranked[0].value : 0; // the #1-ranked item anchors 100
  const rowById = new Map(actionable.map((a) => [a.canvasId, a]));

  // Keep the displayed score MONOTONIC with the rank: a high-value but low-ranked
  // item (e.g. a big undated one held back by dated-first) can never show a bigger
  // number than the item above it.
  let cap = 100;
  return ranked.map((m): ScoredAssignment => {
    const a = rowById.get(m.canvasId)!;
    const isStudy = isStudyType(typeOf(a));
    const d = daysUntil(a.dueAt, now);
    const raw = topVal > 0 ? (m.value / topVal) * 100 : 0;
    const score = round1(Math.min(raw, cap));
    cap = score;
    return {
      canvasId: m.canvasId,
      name: m.name,
      courseName: m.courseName,
      htmlUrl: a.htmlUrl,
      score,
      reason: reasonFor(isStudy, d, a.pointsPossible),
    };
  });
}
