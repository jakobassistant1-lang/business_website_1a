// Dummy data for the first-run DEMO walkthrough (see app/demo). It defines sample
// Science / Math / History / English coursework and runs it through the REAL
// scheduler + priority ranking (generatePlan / rankRecommendations) — exactly as
// lib/calendarData.ts does for live data — so the demo payload is internally
// consistent and always conforms to the current CalendarData shape (no hand-faked
// plan, no type casts). Pure + deterministic given `now`. No DB, no network.

import { type SchedulerAssignment } from "./scheduler";
import { generateWeekPlan } from "./weekPlan";
import { assessmentTier } from "./studyPlan";
import { TOP_N } from "./priority";
import { rankActiveRows, courseTotalPoints } from "./rankActive";
import { ymd } from "./calendarDates";
import { deriveCourseGrade } from "./courseGrade";
import type { CalendarData, CalendarItem } from "./calendarData";
import type { CalendarEvent } from "./calendar/types";
import { isStudyType, type ItemType } from "./itemType";

const HOURS_PER_DAY = 4; // a busy-but-realistic demo budget so the week isn't crammed
const EFFORT_HOURS = 1.5; // lighter default effort → the spaced study sessions have room to breathe
const WINDOW_DAYS = 7;

// Course names use the app's "Short · Long" convention; the UI shows the part
// before " · ", so these read as Science / Math / History / English.
const COURSE = {
  science: "Science · Biology",
  math: "Math · Calculus",
  history: "History · U.S. History",
  english: "English · Literature",
} as const;

// Each course needs a stable Canvas-style id — the Courses grid groups items by it.
const COURSE_ID: Record<string, number> = {
  [COURSE.science]: 201,
  [COURSE.math]: 202,
  [COURSE.history]: 203,
  [COURSE.english]: 204,
};

interface DemoRow {
  canvasId: number;
  name: string;
  courseName: string;
  type: ItemType;
  dueOffsetDays: number | null; // days from today; null = undated
  dueHour?: number;
  pointsPossible: number | null;
  estimatedEffortHours?: number | null;
  effortBucket?: string | null;
  studyLeadDays?: number | null; // set on exam/quiz so the scheduler places study blocks
  summary?: string | null;
  done?: boolean;
  // Grade-calculator inputs: raw points earned (graded rows only) + the Canvas
  // assignment group and its weight. Omit on a points-based course (English).
  score?: number | null;
  groupId?: number | null;
  groupName?: string | null;
  groupWeight?: number | null;
}

// Active coursework (10 items) is unchanged so the Dashboard / Plan / Timeline read
// exactly as before; we ADD graded history (done rows) + Canvas category weights so
// the per-course Grade calculator has real graded work to reason about. Three courses
// are weighted (Science / Math / History); English stays points-based to show that
// mode. Ids are unique but not sequential.
const ROWS: DemoRow[] = [
  // Biology — weighted: Exams 50%, Quizzes 20%, Labs 30%
  { canvasId: 1, name: "Lab Report 2", courseName: COURSE.science, type: "assignment", dueOffsetDays: -1, pointsPossible: 40, estimatedEffortHours: 1.5, effortBucket: "medium", summary: "Write up the cell-division lab with your data and a short conclusion.", groupId: 2013, groupName: "Labs", groupWeight: 30 },
  { canvasId: 6, name: "Quiz: Cell Division", courseName: COURSE.science, type: "quiz", dueOffsetDays: 3, pointsPossible: 30, studyLeadDays: 2, groupId: 2012, groupName: "Quizzes", groupWeight: 20 },
  { canvasId: 9, name: "Midterm Exam", courseName: COURSE.science, type: "exam", dueOffsetDays: 6, pointsPossible: 150, studyLeadDays: 5, summary: "Covers chapters 1–6: cells, energy, and genetics.", groupId: 2011, groupName: "Exams", groupWeight: 50 },
  { canvasId: 12, name: "Lab Report 1", courseName: COURSE.science, type: "assignment", dueOffsetDays: -10, pointsPossible: 40, done: true, score: 36, groupId: 2013, groupName: "Labs", groupWeight: 30, summary: "Microscope lab — graded." },
  { canvasId: 13, name: "Quiz: Cells", courseName: COURSE.science, type: "quiz", dueOffsetDays: -12, pointsPossible: 30, done: true, score: 24, groupId: 2012, groupName: "Quizzes", groupWeight: 20 },
  { canvasId: 14, name: "Quiz: Energy", courseName: COURSE.science, type: "quiz", dueOffsetDays: -6, pointsPossible: 30, done: true, score: 27, groupId: 2012, groupName: "Quizzes", groupWeight: 20 },
  // Calculus — weighted: Problem sets 60%, Exams 40%
  { canvasId: 4, name: "Problem Set 6", courseName: COURSE.math, type: "assignment", dueOffsetDays: 1, pointsPossible: 40, estimatedEffortHours: 2, effortBucket: "medium", summary: "Work the integration set in order — u-substitution first, then the trig integrals. Show each step for full marks.", groupId: 2021, groupName: "Problem sets", groupWeight: 60 },
  { canvasId: 2, name: "Problem Set 5", courseName: COURSE.math, type: "assignment", dueOffsetDays: -3, pointsPossible: 40, done: true, score: 38, summary: "Five derivative problems — already submitted. Nice work.", groupId: 2021, groupName: "Problem sets", groupWeight: 60 },
  { canvasId: 15, name: "Problem Set 4", courseName: COURSE.math, type: "assignment", dueOffsetDays: -10, pointsPossible: 40, done: true, score: 36, groupId: 2021, groupName: "Problem sets", groupWeight: 60, summary: "Chain-rule practice — graded." },
  { canvasId: 16, name: "Midterm", courseName: COURSE.math, type: "exam", dueOffsetDays: -8, pointsPossible: 100, done: true, score: 90, groupId: 2022, groupName: "Exams", groupWeight: 40, summary: "Limits and derivatives — graded." },
  // U.S. History — weighted: Essays 60%, Responses 40% (instructor hides the total)
  { canvasId: 3, name: "Reading Response", courseName: COURSE.history, type: "other", dueOffsetDays: 0, dueHour: 23, pointsPossible: 15, summary: "One paragraph reacting to the assigned chapter.", groupId: 2032, groupName: "Responses", groupWeight: 40 },
  { canvasId: 5, name: "Essay Draft", courseName: COURSE.history, type: "assignment", dueOffsetDays: 2, pointsPossible: 80, estimatedEffortHours: 3, effortBucket: "long", summary: "First draft of the Civil War essay — thesis plus three sources.", groupId: 2031, groupName: "Essays", groupWeight: 60 },
  { canvasId: 10, name: "Research Paper", courseName: COURSE.history, type: "assignment", dueOffsetDays: 6, pointsPossible: 120, estimatedEffortHours: 4, effortBucket: "long", summary: "8–10 pages with a works-cited page.", groupId: 2031, groupName: "Essays", groupWeight: 60 },
  { canvasId: 17, name: "Reading Response 1", courseName: COURSE.history, type: "other", dueOffsetDays: -9, pointsPossible: 15, done: true, score: 14, groupId: 2032, groupName: "Responses", groupWeight: 40, summary: "Chapter 1 reaction — graded." },
  // Literature — points-based (no category weights), nothing graded yet
  { canvasId: 7, name: "Discussion Post", courseName: COURSE.english, type: "other", dueOffsetDays: 4, dueHour: 23, pointsPossible: 20, summary: "Post a short reaction to this week's reading, then reply to at least one classmate before midnight." },
  { canvasId: 8, name: "Vocabulary Quiz", courseName: COURSE.english, type: "quiz", dueOffsetDays: 5, pointsPossible: 20, studyLeadDays: 2 },
  { canvasId: 11, name: "Class Participation", courseName: COURSE.english, type: "other", dueOffsetDays: null, pointsPossible: 30, summary: "Stay engaged in class — ask questions and join discussions. Graded on your contributions across the term." },
];

export function buildDemoCalendarData(now: Date = new Date()): { data: CalendarData; todayYmd: string } {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const dueDate = (off: number | null, hour = 17): Date | null => {
    if (off === null) return null;
    const d = new Date(today);
    d.setDate(d.getDate() + off);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const isoAt = (off: number, hour: number): string => {
    const d = new Date(today);
    d.setDate(d.getDate() + off);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };

  const activeRows = ROWS.filter((r) => !r.done);
  const doneRows = ROWS.filter((r) => r.done);

  // Run the demo coursework through the real planner + ranker (same calls as
  // loadCalendarData) so plan / ranked / atRisk / overloadHours are all genuine.
  // Same v1 marginal ranking as live data (lib/rankActive), so the demo's
  // "do next" order matches what real students see (points → course-grade share).
  const totals = courseTotalPoints(
    activeRows.concat(doneRows).map((r) => ({ courseCanvasId: COURSE_ID[r.courseName] ?? 0, pointsPossible: r.pointsPossible })),
  );
  const ranked = rankActiveRows(
    activeRows.map((r) => ({
      canvasId: r.canvasId,
      name: r.name,
      courseName: r.courseName,
      courseCanvasId: COURSE_ID[r.courseName] ?? 0,
      dueAt: dueDate(r.dueOffsetDays, r.dueHour),
      pointsPossible: r.pointsPossible,
      htmlUrl: null,
      submissionType: null,
      estimatedEffortHours: r.estimatedEffortHours ?? null,
      type: r.type,
    })),
    totals,
    EFFORT_HOURS,
    now,
  );
  // Raw marginal value (not the rounded display score), screened set only — mirrors lib/calendarData.
  const valueOf = new Map(ranked.map((r) => [r.canvasId, r.value ?? 0]));

  // Same v1 week scheduler as live data (lib/weekPlan): spaced study sessions + ≤1h chunks.
  const assignments: SchedulerAssignment[] = activeRows
    .filter((r) => valueOf.has(r.canvasId))
    .map((r) => ({
      canvasId: r.canvasId,
      name: r.name,
      courseName: r.courseName,
      dueAt: dueDate(r.dueOffsetDays, r.dueHour),
      pointsPossible: r.pointsPossible,
      htmlUrl: null,
      estimatedEffortHours: r.estimatedEffortHours ?? null,
      summary: r.summary ?? null,
      studyLeadDays: r.studyLeadDays ?? null,
      aiImportance: null,
      assessmentTier: isStudyType(r.type) ? assessmentTier(r.type, r.name) : null,
      value: valueOf.get(r.canvasId) ?? 0,
    }));

  const plan = generateWeekPlan(assignments, HOURS_PER_DAY, WINDOW_DAYS, EFFORT_HOURS, now);

  const overdue = new Set(plan.atRisk.filter((r) => r.kind === "overdue").map((r) => r.canvasId));
  // Demo "do next" uses the SAME value-first ranking as the live app (Calvin):
  // `ranked` above is rankActiveRows (marginal value), not a demo-only deadline sort.
  const recommendations = ranked.filter((r) => !overdue.has(r.canvasId)).slice(0, TOP_N);

  const toItem = (r: DemoRow, done: boolean): CalendarItem => {
    const due = dueDate(r.dueOffsetDays, r.dueHour);
    return {
      canvasId: r.canvasId,
      name: r.name,
      courseName: r.courseName,
      courseCanvasId: COURSE_ID[r.courseName] ?? 0,
      dueAt: due ? due.toISOString() : null,
      type: r.type,
      status: done ? "done" : overdue.has(r.canvasId) ? "overdue" : "normal",
      studyLeadDays: r.studyLeadDays ?? null,
      pointsPossible: r.pointsPossible,
      estimatedEffortHours: r.estimatedEffortHours ?? null,
      effortBucket: r.effortBucket ?? null,
      summary: r.summary ?? null,
      htmlUrl: null,
      score: r.score ?? null,
      groupId: r.groupId ?? null,
      groupName: r.groupName ?? null,
      groupWeight: r.groupWeight ?? null,
    };
  };

  const events: CalendarEvent[] = [
    { title: "Work shift", startTime: isoAt(0, 16), endTime: isoAt(0, 19), allDay: false, location: null, source: "google" },
    { title: "Study group", startTime: isoAt(2, 18), endTime: isoAt(2, 19), allDay: false, location: null, source: "google" },
  ];

  const data: CalendarData = {
    connected: true,
    syncedAt: isoAt(0, 9),
    validationStatus: "valid",
    stale: false,
    hoursPerDay: HOURS_PER_DAY,
    windowDays: WINDOW_DAYS,
    overloadHours: plan.overloadHours,
    items: activeRows.map((r) => toItem(r, false)),
    completed: doneRows.map((r) => toItem(r, true)),
    // All three honest grade states, so the demo Courses page shows each: two
    // real totals, one HIDDEN by the instructor, one with nothing graded yet.
    courses: [
      { canvasId: COURSE_ID[COURSE.science], name: COURSE.science, grade: deriveCourseGrade(88, "B+", true), latestAnnouncement: { title: "Lab moved to room 214 this week", postedAt: isoAt(0, 8) } },
      { canvasId: COURSE_ID[COURSE.math], name: COURSE.math, grade: deriveCourseGrade(92, "A-", true), latestAnnouncement: { title: "Problem Set 6 hint posted", postedAt: isoAt(-1, 16) } },
      { canvasId: COURSE_ID[COURSE.history], name: COURSE.history, grade: deriveCourseGrade(null, null, true), latestAnnouncement: { title: "Essay rubric updated — please re-read", postedAt: isoAt(-3, 11) } },
      // No announcement → the card simply omits the row.
      { canvasId: COURSE_ID[COURSE.english], name: COURSE.english, grade: deriveCourseGrade(null, null, false), latestAnnouncement: null },
    ],
    events,
    plan,
    atRisk: plan.atRisk.filter((r) => r.kind === "overdue"),
    recommendations,
    ranked,
  };

  return { data, todayYmd: ymd(today) };
}
