// Data loader for the Calendar + Timeline views. Reuses the deterministic
// scheduler (generatePlan), the priority ranking, calendar busy-time, and the
// stored calendar events — and shapes them into one payload both views consume.
//
// Canvas coursework and calendar data load in parallel; the calendar reads are
// fail-open (loadCalendarEvents never throws), so a
// calendar problem can never break the page.

import { prisma } from "./prisma";
import { generatePlan, type Plan, type SchedulerAssignment, type AtRiskItem } from "./scheduler";
import { rankRecommendations, priorityInputsFromPlan, TOP_N, type ScoredAssignment } from "./priority";
import { loadCalendarEvents } from "./calendar";
import type { CalendarEvent } from "./calendar/types";
import { itemType, isStudyType, type ItemType } from "./itemType";
import { deriveCourseGrade, type CourseGrade } from "./courseGrade";

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
  // Grade-calculator inputs (course page). All null when ungraded / points-based.
  score: number | null; // raw points earned (Canvas submissionScore)
  groupId: number | null; // Canvas assignment_group id
  groupName: string | null;
  groupWeight: number | null; // Canvas group_weight (percent)
}

/** One enrolled course plus its honest grade state (graded / hidden / none) and
 *  its most recent Canvas announcement (null = none posted). */
export interface CourseMeta {
  canvasId: number;
  name: string;
  grade: CourseGrade;
  latestAnnouncement: { title: string; postedAt: string } | null;
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
  courses: CourseMeta[]; // enrolled courses + their honest grade state
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
  const [user, cred, rows, courseRows, announcementRows, events] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.canvasCredential.findUnique({ where: { userId } }),
    loadAssignmentRows(userId),
    prisma.course.findMany({ where: { userId } }),
    prisma.announcement.findMany({ where: { userId, postedAt: { not: null } } }),
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
    return t === "exam" ? user.studyDaysTest : user.studyDaysQuiz;
  };

  const assignments: SchedulerAssignment[] = activeRows.map((a) => ({
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
  }));

  const plan = generatePlan(assignments, hours, PLAN_WINDOW_DAYS, user.defaultEffortHours, new Date());

  const submittedIds = new Set(submittedRows.map((a) => a.canvasId));
  const pointsById = new Map<number, number | null>(activeRows.map((a) => [a.canvasId, a.pointsPossible]));
  const overdue = new Set(plan.atRisk.filter((r) => r.kind === "overdue").map((r) => r.canvasId));

  // Full importance ranking. `recommendations` is the forward-looking "do next"
  // slice — overdue work lives in atRisk (the catch-up rail), not the queue — so
  // the Dashboard, Calendar, and Timeline all agree on what's #1. The Dashboard's
  // Today sort needs every item's rank, so we expose the full `ranked` list too.
  const ranked = rankRecommendations(priorityInputsFromPlan(plan, submittedIds, pointsById), {
    windowDays: PLAN_WINDOW_DAYS,
    effortHours: user.defaultEffortHours,
  }).ranked;
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
    score: a.submissionScore ?? null,
    groupId: a.groupId ?? null,
    groupName: a.groupName ?? null,
    groupWeight: a.groupWeight ?? null,
  });

  // Honest per-course grade. "Graded work" = any assignment Canvas has scored,
  // which lets deriveCourseGrade tell a hidden total apart from "nothing graded
  // yet" when Canvas returns no course total — so we never show a guessed number.
  const gradedCourseIds = new Set(
    rows.filter((a) => a.submissionScore != null || a.submissionState === "graded").map((a) => a.courseCanvasId),
  );
  // Most recent announcement per course (the cards show "what's new" per class).
  const latestAnnByCourse = new Map<number, { title: string; postedAt: string }>();
  for (const an of announcementRows) {
    if (!an.postedAt) continue;
    const cur = latestAnnByCourse.get(an.courseCanvasId);
    if (!cur || an.postedAt.getTime() > new Date(cur.postedAt).getTime()) {
      latestAnnByCourse.set(an.courseCanvasId, { title: an.title, postedAt: an.postedAt.toISOString() });
    }
  }
  const courses: CourseMeta[] = courseRows
    .map((c) => ({
      canvasId: c.canvasId,
      name: c.name,
      grade: deriveCourseGrade(c.currentScore, c.currentGrade, gradedCourseIds.has(c.canvasId)),
      latestAnnouncement: latestAnnByCourse.get(c.canvasId) ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

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
    courses,
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
