// Data loader for the Calendar + Timeline views. Reuses the deterministic
// scheduler (generatePlan), the priority ranking, calendar busy-time, and the
// stored calendar events — and shapes them into one payload both views consume.
//
// Canvas coursework and calendar data load in parallel; the calendar reads are
// fail-open (loadCalendarEvents never throws), so a
// calendar problem can never break the page.

import { prisma } from "./prisma";
import { type Plan, type SchedulerAssignment, type AtRiskItem } from "./scheduler";
import { generateWeekPlan } from "./weekPlan";
import { TOP_N, type ScoredAssignment } from "./priority";
import { rankActiveRows, courseTotalPoints } from "./rankActive";
import { coerceLatePolicy } from "./latePolicy";
import { loadCalendarEvents } from "./calendar";
import type { CalendarEvent } from "./calendar/types";
import { itemType, isStudyType, type ItemType } from "./itemType";
import { assessmentTier } from "./studyPlan";

// The planning window is fixed at 7 days (a week), not user-configurable.
export const PLAN_WINDOW_DAYS = 7;

export type ItemStatus = "done" | "overdue" | "normal";

export interface CalendarItem {
  canvasId: number;
  name: string;
  courseName: string;
  courseCanvasId: number;
  dueAt: string | null; // ISO; null = undated
  type: ItemType;
  status: ItemStatus;
  studyLeadDays: number | null; // effective days-ahead-to-study (null = not a study type)
  pointsPossible: number | null;
  estimatedEffortHours: number | null;
  effortBucket: string | null; // "quick" | "medium" | "long"
  summary: string | null;
  htmlUrl: string | null;
}

export interface CalendarData {
  connected: boolean;
  syncedAt: string | null;
  validationStatus: string | null;
  stale: boolean;
  hoursPerDay: number;
  windowDays: number;
  overloadHours: number; // hours the week is over-subscribed (0 = everything fits)
  items: CalendarItem[]; // active coursework (includes undated, dueAt === null)
  completed: CalendarItem[]; // submitted/graded
  events: CalendarEvent[]; // calendar "busy" blocks
  plan: Plan; // scheduler output (powers the Timeline)
  atRisk: AtRiskItem[];
  recommendations: ScoredAssignment[]; // forward-looking "do next" slice (overdue excluded)
  ranked: ScoredAssignment[]; // full importance ranking (drives the Dashboard's Today sort)
}

type AssignmentRow = Awaited<ReturnType<typeof loadAssignmentRows>>[number];
function loadAssignmentRows(userId: number) {
  return prisma.assignment.findMany({ where: { userId }, include: { course: true } });
}

export async function loadCalendarData(userId: number, hoursOverride?: number): Promise<CalendarData> {
  const [user, cred, rows, events] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.canvasCredential.findUnique({ where: { userId } }),
    loadAssignmentRows(userId),
    loadCalendarEvents(userId),
  ]);

  const hours =
    hoursOverride !== undefined && Number.isFinite(hoursOverride) ? hoursOverride : user.defaultHoursPerDay;

  // Same "done" rule as lib/plan.ts: submitted AND not reopened by the instructor.
  const isDone = (a: AssignmentRow) => a.submittedAt !== null && a.submissionState !== "unsubmitted";
  const submittedRows = rows.filter(isDone);
  const activeRows = rows.filter((a) => !isDone(a));

  // Exams/quizzes get study sessions scheduled ahead of their due date. A
  // per-assignment override (set on the assignment card) beats the User default.
  const leadDaysFor = (a: AssignmentRow): number | null => {
    const t = itemType(a.submissionType, a.name);
    if (!isStudyType(t)) return null;
    if (a.studyLeadDays != null) return a.studyLeadDays;
    // Lead window by tier (spec §3): midterm/final 14d, other exam 7d, quiz 3d.
    const tier = assessmentTier(t, a.name);
    return tier === "final" ? user.studyDaysFinal : tier === "exam" ? user.studyDaysTest : user.studyDaysQuiz;
  };

  // v1 prioritizer (docs/navo-priority-v1-spec.md): rank active work by the
  // MARGINAL expected grade-% at stake. Each item's raw points are converted to
  // its share of ITS course grade first (course totals differ, so raw points
  // aren't comparable across classes); current-grade (leverage) + late-policy fail
  // open to neutral/no-credit until synced. `recommendations` is the forward "do
  // next" slice — overdue lives in atRisk (the catch-up rail) — so Dashboard,
  // Calendar, and Timeline agree on #1; the full `ranked` list powers Today's sort.
  const now = new Date();
  const totals = courseTotalPoints(rows.map((a) => ({ courseCanvasId: a.courseCanvasId, pointsPossible: a.pointsPossible })));
  const ranked = rankActiveRows(
    activeRows.map((a) => ({
      canvasId: a.canvasId,
      name: a.name,
      courseName: a.course.name,
      courseCanvasId: a.courseCanvasId,
      dueAt: a.dueAt,
      pointsPossible: a.pointsPossible,
      htmlUrl: a.htmlUrl,
      submissionType: a.submissionType,
      estimatedEffortHours: a.estimatedEffortHours ?? null,
      // v1 signals (null/absent ⇒ fail open): current grade (0–100 → fraction),
      // weighted-group share, parsed late policy, and the AI actionable screen.
      courseGrade: a.course.currentScore != null ? a.course.currentScore / 100 : null,
      gradeWeight: a.gradeWeight,
      latePolicy: a.course.latePolicyKind
        ? coerceLatePolicy({ kind: a.course.latePolicyKind, value: a.course.latePolicyValue })
        : undefined,
      requiresAction: a.aiRequiresAction,
    })),
    totals,
    user.defaultEffortHours,
    now,
  );
  // Marginal value per item → the scheduler's contention currency (spec §8).
  const valueOf = new Map(ranked.map((r) => [r.canvasId, r.score]));

  // v1 week scheduler (docs/navo-scheduling-v1-spec.md): assessments expand into
  // spaced ≤1h study sessions, deliverables into ≤1h chunks, placed under 90% of
  // the daily budget with EDF feasibility → priority(value) → spacing.
  const assignments: SchedulerAssignment[] = activeRows.map((a) => {
    const t = itemType(a.submissionType, a.name);
    return {
      canvasId: a.canvasId,
      name: a.name,
      courseName: a.course.name,
      dueAt: a.dueAt,
      pointsPossible: a.pointsPossible,
      htmlUrl: a.htmlUrl,
      estimatedEffortHours: a.estimatedEffortHours ?? null,
      summary: a.aiSummary ?? null,
      studyLeadDays: leadDaysFor(a),
      aiImportance: a.aiImportance ?? null,
      assessmentTier: isStudyType(t) ? assessmentTier(t, a.name) : null,
      value: valueOf.get(a.canvasId) ?? null,
    };
  });

  const plan = generateWeekPlan(assignments, hours, PLAN_WINDOW_DAYS, user.defaultEffortHours, now);

  const overdue = new Set(plan.atRisk.filter((r) => r.kind === "overdue").map((r) => r.canvasId));
  const recommendations = ranked.filter((r) => !overdue.has(r.canvasId)).slice(0, TOP_N);

  const toItem = (a: AssignmentRow, done: boolean): CalendarItem => ({
    canvasId: a.canvasId,
    name: a.name,
    courseName: a.course.name,
    courseCanvasId: a.courseCanvasId,
    dueAt: a.dueAt ? a.dueAt.toISOString() : null,
    type: itemType(a.submissionType, a.name),
    status: done ? "done" : overdue.has(a.canvasId) ? "overdue" : "normal",
    studyLeadDays: leadDaysFor(a),
    pointsPossible: a.pointsPossible,
    estimatedEffortHours: a.estimatedEffortHours ?? null,
    effortBucket: a.effortBucket ?? null,
    summary: a.aiSummary ?? null,
    htmlUrl: a.htmlUrl,
  });

  const status = cred?.lastValidationStatus ?? null;
  return {
    connected: !!cred,
    syncedAt: cred?.syncedAt ? cred.syncedAt.toISOString() : null,
    validationStatus: status,
    stale: !!cred && status !== null && status !== "valid",
    hoursPerDay: hours,
    windowDays: PLAN_WINDOW_DAYS,
    overloadHours: plan.overloadHours,
    // Only overdue surfaces as an alert now — "won't fit" was removed as noise.
    atRisk: plan.atRisk.filter((r) => r.kind === "overdue"),
    items: activeRows.map((a) => toItem(a, false)),
    completed: submittedRows.map((a) => toItem(a, true)),
    events,
    plan,
    recommendations,
    ranked,
  };
}

/** The Study hub's "upcoming tests" list: quizzes/exams still active (status
 *  "normal" — keeps undated + due-today, drops done/overdue), ordered do-next
 *  (the shared `ranked` order; earliest-due as a tiebreak). Pure. Shared by the
 *  Study page and the first-run demo so the two never drift. */
export function upcomingAssessments(data: CalendarData): CalendarItem[] {
  const rank = new Map(data.ranked.map((r, i) => [r.canvasId, i] as const));
  return data.items
    .filter((it) => (it.type === "quiz" || it.type === "exam") && it.status === "normal")
    .sort((a, b) => {
      const ra = rank.get(a.canvasId) ?? 1e9;
      const rb = rank.get(b.canvasId) ?? 1e9;
      if (ra !== rb) return ra - rb;
      const ta = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
      const tb = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
      return ta - tb;
    });
}
