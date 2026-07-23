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
import { ymd, startOfDay } from "./calendarDates";
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
}

// 11 items across 4 classes: a mix of assignments / quizzes / exam / tasks, with
// one overdue (Lab Report 2), one done (Problem Set 5), and one undated (Class
// Participation). Deadlines are spread across distinct days (-1 → +6) so the
// resulting do-next order reads clearly — urgent-first, then by deadline — instead
// of a confusing cluster of same-day items. Ids are unique but not sequential.
const ROWS: DemoRow[] = [
  // Biology
  { canvasId: 1, name: "Lab Report 2", courseName: COURSE.science, type: "assignment", dueOffsetDays: -1, pointsPossible: 40, estimatedEffortHours: 1.5, effortBucket: "medium", summary: "Write up the cell-division lab with your data and a short conclusion." },
  { canvasId: 6, name: "Quiz: Cell Division", courseName: COURSE.science, type: "quiz", dueOffsetDays: 3, pointsPossible: 30, studyLeadDays: 2 },
  { canvasId: 9, name: "Midterm Exam", courseName: COURSE.science, type: "exam", dueOffsetDays: 6, pointsPossible: 150, studyLeadDays: 5, summary: "Covers chapters 1–6: cells, energy, and genetics." },
  // Calculus
  { canvasId: 4, name: "Problem Set 6", courseName: COURSE.math, type: "assignment", dueOffsetDays: 1, pointsPossible: 40, estimatedEffortHours: 2, effortBucket: "medium", summary: "Work the integration set in order — u-substitution first, then the trig integrals. Show each step for full marks." },
  { canvasId: 2, name: "Problem Set 5", courseName: COURSE.math, type: "assignment", dueOffsetDays: -3, pointsPossible: 40, done: true, summary: "Five derivative problems — already submitted. Nice work." },
  // U.S. History
  { canvasId: 3, name: "Reading Response", courseName: COURSE.history, type: "other", dueOffsetDays: 0, dueHour: 23, pointsPossible: 15, summary: "One paragraph reacting to the assigned chapter." },
  { canvasId: 5, name: "Essay Draft", courseName: COURSE.history, type: "assignment", dueOffsetDays: 2, pointsPossible: 80, estimatedEffortHours: 3, effortBucket: "long", summary: "First draft of the Civil War essay — thesis plus three sources." },
  { canvasId: 10, name: "Research Paper", courseName: COURSE.history, type: "assignment", dueOffsetDays: 6, pointsPossible: 120, estimatedEffortHours: 4, effortBucket: "long", summary: "8–10 pages with a works-cited page." },
  // Literature
  { canvasId: 7, name: "Discussion Post", courseName: COURSE.english, type: "other", dueOffsetDays: 4, dueHour: 23, pointsPossible: 20, summary: "Post a short reaction to this week's reading, then reply to at least one classmate before midnight." },
  { canvasId: 8, name: "Vocabulary Quiz", courseName: COURSE.english, type: "quiz", dueOffsetDays: 5, pointsPossible: 20, studyLeadDays: 2 },
  // Ongoing / undated
  { canvasId: 11, name: "Class Participation", courseName: COURSE.english, type: "other", dueOffsetDays: null, pointsPossible: 30, summary: "Stay engaged in class — ask questions and join discussions. Graded on your contributions across the term." },
];

export function buildDemoCalendarData(now: Date = new Date()): { data: CalendarData; todayYmd: string } {
  const today = startOfDay(now);
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
      manuallyDone: false, // demo has no persistence — checkoffs are disabled there
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
    events,
    plan,
    atRisk: plan.atRisk.filter((r) => r.kind === "overdue"),
    recommendations,
    ranked,
  };

  return { data, todayYmd: ymd(today) };
}
