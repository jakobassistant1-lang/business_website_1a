// Data loader for the Calendar + Timeline views. Reuses the deterministic
// scheduler (generatePlan), the priority ranking, calendar busy-time, and the
// stored calendar events — and shapes them into one payload both views consume.
//
// Canvas coursework and calendar data load in parallel; the calendar reads are
// fail-open (loadBusyHoursByDate / loadCalendarEvents never throw), so a
// calendar problem can never break the page.

import { prisma } from "./prisma";
import { generatePlan, type Plan, type SchedulerAssignment, type AtRiskItem } from "./scheduler";
import { rankRecommendations, priorityInputsFromPlan, type ScoredAssignment } from "./priority";
import { loadBusyHoursByDate, loadCalendarEvents } from "./calendar";
import type { CalendarEvent } from "./calendar/types";
import { itemType, type ItemType } from "./itemType";

// The planning window is fixed at 7 days (a week), not user-configurable.
export const PLAN_WINDOW_DAYS = 7;

export type ItemStatus = "done" | "overdue" | "normal";

export interface CalendarItem {
  canvasId: number;
  name: string;
  courseName: string;
  dueAt: string | null; // ISO; null = undated
  type: ItemType;
  status: ItemStatus;
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
  items: CalendarItem[]; // active coursework (includes undated, dueAt === null)
  completed: CalendarItem[]; // submitted/graded
  events: CalendarEvent[]; // calendar "busy" blocks
  plan: Plan; // scheduler output (powers the Timeline)
  atRisk: AtRiskItem[];
  recommendations: ScoredAssignment[];
}

type AssignmentRow = Awaited<ReturnType<typeof loadAssignmentRows>>[number];
function loadAssignmentRows(userId: number) {
  return prisma.assignment.findMany({ where: { userId }, include: { course: true } });
}

export async function loadCalendarData(userId: number, hoursOverride?: number): Promise<CalendarData> {
  const [user, cred, rows, busyHoursByDate, events] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.canvasCredential.findUnique({ where: { userId } }),
    loadAssignmentRows(userId),
    loadBusyHoursByDate(userId),
    loadCalendarEvents(userId),
  ]);

  const hours =
    hoursOverride !== undefined && Number.isFinite(hoursOverride) ? hoursOverride : user.defaultHoursPerDay;

  // Same "done" rule as lib/plan.ts: submitted AND not reopened by the instructor.
  const isDone = (a: AssignmentRow) => a.submittedAt !== null && a.submissionState !== "unsubmitted";
  const submittedRows = rows.filter(isDone);
  const activeRows = rows.filter((a) => !isDone(a));

  // Exams/quizzes get study sessions scheduled ahead of their due date.
  const leadDaysFor = (a: AssignmentRow): number | null => {
    const t = itemType(a.submissionType, a.name);
    return t === "exam" ? user.studyDaysTest : t === "quiz" ? user.studyDaysQuiz : null;
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
  }));

  const plan = generatePlan(assignments, hours, PLAN_WINDOW_DAYS, user.defaultEffortHours, new Date(), busyHoursByDate);

  const submittedIds = new Set(submittedRows.map((a) => a.canvasId));
  const pointsById = new Map<number, number | null>(activeRows.map((a) => [a.canvasId, a.pointsPossible]));
  const recommendations = rankRecommendations(priorityInputsFromPlan(plan, submittedIds, pointsById), {
    windowDays: PLAN_WINDOW_DAYS,
    effortHours: user.defaultEffortHours,
  }).top;

  const overdue = new Set(plan.atRisk.filter((r) => r.kind === "overdue").map((r) => r.canvasId));

  const toItem = (a: AssignmentRow, done: boolean): CalendarItem => ({
    canvasId: a.canvasId,
    name: a.name,
    courseName: a.course.name,
    dueAt: a.dueAt ? a.dueAt.toISOString() : null,
    type: itemType(a.submissionType, a.name),
    status: done ? "done" : overdue.has(a.canvasId) ? "overdue" : "normal",
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
    // Only overdue surfaces as an alert now — "won't fit" was removed as noise.
    atRisk: plan.atRisk.filter((r) => r.kind === "overdue"),
    items: activeRows.map((a) => toItem(a, false)),
    completed: submittedRows.map((a) => toItem(a, true)),
    events,
    plan,
    recommendations,
  };
}
