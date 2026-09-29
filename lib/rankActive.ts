// Builds the user-facing importance ranking from synced assignment rows using the
// v1 marginal prioritizer (lib/marginalPriority + docs/navo-priority-v1-spec.md).
//
// Each item's weight is its SHARE OF ITS COURSE GRADE — the stored
// `Assignment.gradeWeight` (written at sync by lib/gradeWeight), else THE share rule
// `gradeShareFor` over the course's posted items (a course with fewer than
// THIN_COURSE_MIN_ITEMS pointed items posted never hands one item its whole grade).
// Days until due are read in the STUDENT's zone (lib/studentZone.dayDiffInZone), so
// the urgency cliff fires on the day the student sees. Owner's rules (2026-09-28):
// unopened and passive items stay in the ranking at importance 0 (bottom), and an
// unknown late policy is `null`, never "late work not accepted".

import { isZeroImportance, rankItems, type MarginalInput } from "./marginalPriority";
import type { LatePolicy } from "./latePolicy";
import { computeGradeWeights, courseGradeShares, gradeShareFor, resolveWeight, usesGroupWeights } from "./gradeWeight";
import type { GradingScheme } from "./gradingScheme";
import { itemType, isStudyType, isPassiveItem, type ItemType } from "./itemType";
import { DEFAULT_STUDENT_ZONE, dayDiffInZone, todayInZone } from "./studentZone";
import { dueParts, formatDue } from "./dueLabel";
import { MONTHS_SHORT } from "./calendarDates";
import { round1 } from "./round";
import { TOP_N, type ScoredAssignment } from "./priority";

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
  /** Canvas unlock date. In the future ⇒ the teacher hasn't opened it: importance 0. */
  unlockAt?: Date | null;
  // Richer signals — optional; absent ⇒ fail open (see module header).
  courseGrade?: number | null; // current grade fraction 0..1
  /** The course's stored late policy. null/absent = UNKNOWN (no stored policy). */
  latePolicy?: LatePolicy | null;
  gradeWeight?: number | null; // stored share of grade (lib/gradeWeight, written at sync)
  requiresAction?: boolean | null; // false + no online submission + not an exam/quiz ⇒ passive (importance 0)
}

const typeOf = (a: RankableRow): ItemType => a.type ?? itemType(a.submissionType, a.name);

/** Is this row unopened (unlock date still in the future)? THE locked predicate. */
export function isLockedRow(a: { unlockAt?: Date | null }, now: Date): boolean {
  return a.unlockAt != null && a.unlockAt.getTime() > now.getTime();
}

export interface ReasonCtx {
  zone: string;
  todayYmd: string;
  /** The current instant — a study item due earlier today reads "Earlier today". */
  now?: Date;
}

/** The ranking's one-phrase reason, in the SAME words as the date labels
 *  (lib/dueLabel `formatDue(…, "countdown")`): "Due tomorrow · 70 pts",
 *  "Due Wednesday · 70 pts", "Past due · 70 pts", "Exam Friday · 100 pts",
 *  "Earlier today · 20 pts" (an exam/quiz whose time has passed today),
 *  "Opens Oct 3", "Graded by your teacher", "No due date". Never "Overdue". */
export function reasonFor(
  a: { type: ItemType; dueAt: Date | null; pointsPossible: number | null; locked: boolean; passive: boolean; unlockAt?: Date | null },
  ctx: ReasonCtx,
): string {
  if (a.passive) return "Graded by your teacher";
  const parts: string[] = [];
  if (a.locked && a.unlockAt) {
    const p = dueParts(a.unlockAt.toISOString(), ctx.zone);
    parts.push(`Opens ${MONTHS_SHORT[p.month]} ${p.day}`);
  } else if (!a.dueAt) {
    parts.push("No due date");
  } else if (isPastDay(a.dueAt, ctx)) {
    parts.push("Past due");
  } else if (isStudyType(a.type) && ctx.now && a.dueAt.getTime() < ctx.now.getTime()) {
    parts.push("Earlier today");
  } else {
    const label = formatDue(a.dueAt.toISOString(), "countdown", { todayYmd: ctx.todayYmd, timeZone: ctx.zone });
    const prefix = a.type === "exam" ? "Exam" : a.type === "quiz" ? "Quiz" : "Due";
    parts.push(`${prefix} ${label === "Today" || label === "Tomorrow" ? label.toLowerCase() : label}`);
  }
  if (a.pointsPossible != null && a.pointsPossible > 0) parts.push(`${a.pointsPossible} pts`);
  return parts.join(" · ");
}

// A due day before `todayYmd` in the zone (compares calendar days, like lib/dueLabel.isPastDue).
function isPastDay(due: Date, ctx: ReasonCtx): boolean {
  return dueParts(due.toISOString(), ctx.zone).ymd < ctx.todayYmd;
}

/** What a course has POSTED so far (every synced row, done or not): Σ points over
 *  its pointed items and how many there are — the inputs to the thin-course rule. */
export interface CoursePosted {
  points: number;
  count: number;
}

/** Posted totals per course (keyed by courseCanvasId) over ALL of a course's rows. */
export function courseTotalPoints(allRows: { courseCanvasId: number; pointsPossible: number | null }[]): Map<number, CoursePosted> {
  const totals = new Map<number, CoursePosted>();
  for (const a of allRows) {
    if (a.pointsPossible != null && Number.isFinite(a.pointsPossible) && a.pointsPossible > 0) {
      const cur = totals.get(a.courseCanvasId) ?? { points: 0, count: 0 };
      totals.set(a.courseCanvasId, { points: cur.points + a.pointsPossible, count: cur.count + 1 });
    }
  }
  return totals;
}

/** Rank-time fallback for rows with no stored `gradeWeight` (e.g. created by a quick
 *  sync): THE share rule over each whole course — Canvas weighted groups, the
 *  syllabus scheme, posted points (thin-course gated), type default. Keyed by canvasId. */
export function fallbackGradeShares(
  allRows: {
    canvasId: number;
    courseCanvasId: number;
    name: string;
    pointsPossible: number | null;
    groupId: number | null;
    groupName: string | null;
    groupWeight: number | null;
    type: ItemType;
  }[],
  schemes: Map<number, GradingScheme | null>,
): Map<number, number> {
  const byCourse = new Map<number, typeof allRows>();
  for (const r of allRows) byCourse.set(r.courseCanvasId, [...(byCourse.get(r.courseCanvasId) ?? []), r]);
  const out = new Map<number, number>();
  for (const [courseId, rows] of byCourse) {
    const groups = new Map<number, { id: number; groupWeight: number | null; assignments: { canvasId: number; pointsPossible: number | null }[] }>();
    for (const r of rows) {
      if (r.groupId == null) continue;
      const g = groups.get(r.groupId) ?? { id: r.groupId, groupWeight: r.groupWeight, assignments: [] };
      g.assignments.push({ canvasId: r.canvasId, pointsPossible: r.pointsPossible });
      groups.set(r.groupId, g);
    }
    const groupList = [...groups.values()];
    const canvasWeighted = usesGroupWeights(groupList)
      ? new Map(computeGradeWeights(groupList).map((w) => [w.canvasId, w.gradeWeight]))
      : null;
    const shares = courseGradeShares(
      rows.map((r) => ({ canvasId: r.canvasId, name: r.name, points: r.pointsPossible, groupName: r.groupName, type: r.type })),
      { canvasWeighted, scheme: schemes.get(courseId) ?? null },
    );
    for (const [id, s] of shares) out.set(id, s.share);
  }
  return out;
}

/** The Focus slice (owner, 2026-09-28): "focus should be the top priority no matter
 *  what that is" — the first `n` of `ranked` with importance > 0 that are not
 *  unopened and not passive. Past-due items are INCLUDED. */
export function focusSlice(ranked: ScoredAssignment[], n: number = TOP_N): ScoredAssignment[] {
  return ranked.filter((r) => !isZeroImportance(r) && !r.locked && !r.passive).slice(0, n);
}

/** Rank active coursework by marginal expected grade-% at stake (importance),
 *  highest first, in the `ScoredAssignment` shape the UI already consumes. Every
 *  row stays in the result — unopened and passive rows at importance 0 at the
 *  bottom. `zone` = the student's zone (lib/studentZone.studentZone(user)). */
export function rankActiveRows(
  active: RankableRow[],
  totals: Map<number, CoursePosted>,
  defaultEffort: number,
  now: Date,
  zone: string = DEFAULT_STUDENT_ZONE,
): ScoredAssignment[] {
  const flags = new Map(
    active.map((a) => {
      const type = typeOf(a);
      return [
        a.canvasId,
        {
          type,
          locked: isLockedRow(a, now),
          passive: isPassiveItem({ requiresAction: a.requiresAction, submissionType: a.submissionType, type }),
        },
      ] as const;
    }),
  );
  const inputs: MarginalInput[] = active.map((a) => {
    const f = flags.get(a.canvasId)!;
    const posted = totals.get(a.courseCanvasId) ?? { points: 0, count: 0 };
    const share =
      a.gradeWeight != null
        ? resolveWeight(a.gradeWeight, f.type)
        : gradeShareFor({
            canvasWeightedShare: null,
            scheme: null,
            category: null,
            points: a.pointsPossible,
            postedTotalPoints: posted.points,
            postedPointedCount: posted.count,
            type: f.type,
          }).share;
    return {
      canvasId: a.canvasId,
      name: a.name,
      courseName: a.courseName,
      kind: isStudyType(f.type) ? "study" : "assignment",
      weight: share,
      courseGrade: a.courseGrade ?? null,
      dueInDays: a.dueAt ? dayDiffInZone(a.dueAt, zone, now) : null,
      dueAtMs: a.dueAt ? a.dueAt.getTime() : null,
      duePassed: a.dueAt != null && a.dueAt.getTime() < now.getTime(),
      points: a.pointsPossible,
      courseId: a.courseCanvasId,
      effortHours: a.estimatedEffortHours ?? defaultEffort,
      latePolicy: a.latePolicy ?? null,
      submitted: false,
      locked: f.locked,
      passive: f.passive,
    };
  });

  const ranked = rankItems(inputs);
  const topVal = ranked.length > 0 ? ranked[0].value : 0; // the #1-ranked item anchors 100
  const rowById = new Map(active.map((a) => [a.canvasId, a]));
  const reasonCtx: ReasonCtx = { zone, todayYmd: todayInZone(zone, now), now };

  // Keep the displayed score MONOTONIC with the rank: a high-value but low-ranked
  // item (e.g. a big undated one held back by dated-first) can never show a bigger
  // number than the item above it.
  let cap = 100;
  return ranked.map((m): ScoredAssignment => {
    const a = rowById.get(m.canvasId)!;
    const f = flags.get(m.canvasId)!;
    const raw = topVal > 0 ? (m.value / topVal) * 100 : 0;
    const score = round1(Math.min(raw, cap));
    cap = score;
    return {
      canvasId: m.canvasId,
      name: m.name,
      courseName: m.courseName,
      htmlUrl: a.htmlUrl,
      score,
      value: m.value, // raw marginal value (uncapped) for the scheduler's contention
      reason: reasonFor({ type: f.type, dueAt: a.dueAt, pointsPossible: a.pointsPossible, locked: f.locked, passive: f.passive, unlockAt: a.unlockAt }, reasonCtx),
      locked: f.locked,
      passive: f.passive,
    };
  });
}
