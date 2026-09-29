// Dummy data for the first-run DEMO walkthrough (see app/demo). It defines sample
// Science / Math / History / English coursework and derives EVERYTHING the way
// lib/calendarData.ts does for a real account — so the demo behaves like live data:
//   • item type from Canvas-style `submission_types` + name (lib/itemType.itemType),
//     never set by hand; passive grades via the same isPassiveItem rule;
//   • effort through lib/effort (effectiveEffort / effortOrDefault — padded once);
//   • ranking with each course's grade (leverage), like live;
//   • days, due times and "today" in ONE student zone (lib/studentZone);
//   • done items carry the same doneReason rule (graded when Canvas scored it).
// Output always conforms to CalendarData (no hand-faked plan, no casts). Pure +
// deterministic given `now`. No DB, no network.

import { type SchedulerAssignment } from "./scheduler";
import { generateWeekPlan } from "./weekPlan";
import { assessmentTier } from "./studyPlan";
import { rankActiveRows, courseTotalPoints, fallbackGradeShares, focusSlice } from "./rankActive";
import { addDays, parseYmd, ymd } from "./calendarDates";
import { deriveCourseGrade } from "./courseGrade";
import { effectiveEffort, effortOrDefault } from "./effort";
import { DEFAULT_STUDENT_ZONE, todayInZone } from "./studentZone";
import type { CalendarData, CalendarItem } from "./calendarData";
import type { CalendarEvent } from "./calendar/types";
import { isPassiveItem, isStudyType, itemType } from "./itemType";
import { assignmentDoneReason } from "./assignmentStatus";

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
  /** Canvas `submission_types`, comma-joined — the type is DERIVED from it + the name. */
  submissionType: string;
  /** The AI actionable screen's verdict (false = a passive grade like participation). */
  requiresAction?: boolean;
  dueOffsetDays: number | null; // days from today; null = undated
  dueHour?: number;
  pointsPossible: number | null;
  estimatedEffortHours?: number | null;
  effortBucket?: string | null;
  studyLeadDays?: number | null; // set on exam/quiz so the scheduler places study blocks
  summary?: string | null;
  /** The student handed it in (Canvas submission). With a `score`, Canvas graded it. */
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
  { canvasId: 1, name: "Lab Report 2", courseName: COURSE.science, submissionType: "online_upload", dueOffsetDays: -1, pointsPossible: 40, estimatedEffortHours: 1.5, effortBucket: "medium", summary: "Write up the cell-division lab with your data and a short conclusion.", groupId: 2013, groupName: "Labs", groupWeight: 30 },
  { canvasId: 6, name: "Quiz: Cell Division", courseName: COURSE.science, submissionType: "online_quiz", dueOffsetDays: 3, pointsPossible: 30, studyLeadDays: 2, groupId: 2012, groupName: "Quizzes", groupWeight: 20 },
  { canvasId: 9, name: "Midterm Exam", courseName: COURSE.science, submissionType: "on_paper", dueOffsetDays: 6, pointsPossible: 150, studyLeadDays: 5, summary: "Covers chapters 1–6: cells, energy, and genetics.", groupId: 2011, groupName: "Exams", groupWeight: 50 },
  { canvasId: 12, name: "Lab Report 1", courseName: COURSE.science, submissionType: "online_upload", dueOffsetDays: -10, pointsPossible: 40, done: true, score: 36, groupId: 2013, groupName: "Labs", groupWeight: 30, summary: "Microscope lab — graded." },
  { canvasId: 13, name: "Quiz: Cells", courseName: COURSE.science, submissionType: "online_quiz", dueOffsetDays: -12, pointsPossible: 30, done: true, score: 24, groupId: 2012, groupName: "Quizzes", groupWeight: 20 },
  { canvasId: 14, name: "Quiz: Energy", courseName: COURSE.science, submissionType: "online_quiz", dueOffsetDays: -6, pointsPossible: 30, done: true, score: 27, groupId: 2012, groupName: "Quizzes", groupWeight: 20 },
  // Calculus — weighted: Problem sets 60%, Exams 40%
  { canvasId: 4, name: "Problem Set 6", courseName: COURSE.math, submissionType: "online_upload", dueOffsetDays: 1, pointsPossible: 40, estimatedEffortHours: 2, effortBucket: "medium", summary: "Work the integration set in order — u-substitution first, then the trig integrals. Show each step for full marks.", groupId: 2021, groupName: "Problem sets", groupWeight: 60 },
  { canvasId: 2, name: "Problem Set 5", courseName: COURSE.math, submissionType: "online_upload", dueOffsetDays: -3, pointsPossible: 40, done: true, score: 38, summary: "Five derivative problems — graded. Nice work.", groupId: 2021, groupName: "Problem sets", groupWeight: 60 },
  { canvasId: 15, name: "Problem Set 4", courseName: COURSE.math, submissionType: "online_upload", dueOffsetDays: -10, pointsPossible: 40, done: true, score: 36, groupId: 2021, groupName: "Problem sets", groupWeight: 60, summary: "Chain-rule practice — graded." },
  { canvasId: 16, name: "Midterm", courseName: COURSE.math, submissionType: "on_paper", dueOffsetDays: -8, pointsPossible: 100, done: true, score: 90, groupId: 2022, groupName: "Exams", groupWeight: 40, summary: "Limits and derivatives — graded." },
  // U.S. History — weighted: Essays 60%, Responses 40% (instructor hides the total)
  { canvasId: 3, name: "Reading Response", courseName: COURSE.history, submissionType: "discussion_topic", dueOffsetDays: 0, dueHour: 23, pointsPossible: 15, summary: "One paragraph reacting to the assigned chapter.", groupId: 2032, groupName: "Responses", groupWeight: 40 },
  { canvasId: 5, name: "Essay Draft", courseName: COURSE.history, submissionType: "online_upload", dueOffsetDays: 2, pointsPossible: 80, estimatedEffortHours: 3, effortBucket: "long", summary: "First draft of the Civil War essay — thesis plus three sources.", groupId: 2031, groupName: "Essays", groupWeight: 60 },
  { canvasId: 10, name: "Research Paper", courseName: COURSE.history, submissionType: "online_upload", dueOffsetDays: 6, pointsPossible: 120, estimatedEffortHours: 4, effortBucket: "long", summary: "8–10 pages with a works-cited page.", groupId: 2031, groupName: "Essays", groupWeight: 60 },
  { canvasId: 17, name: "Reading Response 1", courseName: COURSE.history, submissionType: "discussion_topic", dueOffsetDays: -9, pointsPossible: 15, done: true, score: 14, groupId: 2032, groupName: "Responses", groupWeight: 40, summary: "Chapter 1 reaction — graded." },
  // Literature — points-based (no category weights), nothing graded yet
  { canvasId: 7, name: "Discussion Post", courseName: COURSE.english, submissionType: "discussion_topic", dueOffsetDays: 4, dueHour: 23, pointsPossible: 20, summary: "Post a short reaction to this week’s reading, then reply to at least one classmate before midnight." },
  { canvasId: 8, name: "Vocabulary Quiz", courseName: COURSE.english, submissionType: "online_quiz", dueOffsetDays: 5, pointsPossible: 20, studyLeadDays: 2 },
  { canvasId: 11, name: "Participation", courseName: COURSE.english, submissionType: "none", requiresAction: false, dueOffsetDays: null, pointsPossible: 30, summary: "Stay engaged in lectures: ask questions and join discussions. Graded on your contributions across the term." },
];

// Each course's Canvas total (score 0–100 + letter) — null = no total shown. All
// three honest grade states: two real totals, one HIDDEN by the instructor, one
// with nothing graded yet. Feeds BOTH the ranking (leverage, like live) and the
// Courses page's grade pills, so the two can't drift.
const COURSE_TOTAL: Record<string, { score: number | null; letter: string | null }> = {
  [COURSE.science]: { score: 88, letter: "B+" },
  [COURSE.math]: { score: 92, letter: "A-" },
  [COURSE.history]: { score: null, letter: null },
  [COURSE.english]: { score: null, letter: null },
};

/** The instant a wall-clock time on a calendar day has in `zone` ("5 PM on Oct 3
 *  in New York"). Two passes settle the offset across a DST change. */
function zonedInstant(dayYmd: string, hour: number, zone: string): Date {
  const [y, m, d] = dayYmd.split("-").map(Number);
  const want = Date.UTC(y, m - 1, d, hour, 0, 0);
  let t = want;
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(new Date(t));
    const get = (k: string) => Number(parts.find((p) => p.type === k)?.value ?? 0);
    const seen = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    t += want - seen;
  }
  return new Date(t);
}

export function buildDemoCalendarData(now: Date = new Date(), timeZone: string = DEFAULT_STUDENT_ZONE): { data: CalendarData; todayYmd: string } {
  // Every day and time in the demo is read in ONE zone — the student's, like live data.
  const todayYmd = todayInZone(timeZone, now);
  const dayAt = (off: number, hour: number): Date => zonedInstant(ymd(addDays(parseYmd(todayYmd), off)), hour, timeZone);
  const dueDate = (off: number | null, hour = 17): Date | null => (off === null ? null : dayAt(off, hour));
  const isoAt = (off: number, hour: number): string => dayAt(off, hour).toISOString();

  const typeOf = (r: DemoRow) => itemType(r.submissionType, r.name);
  // THE done rule (lib/assignmentStatus), fed the Canvas-style submission fields a
  // live row carries: graded when scored, submitted when handed in, and an
  // exam/quiz whose day has passed in the student's zone counts as done too.
  const doneReasonOf = new Map(
    ROWS.map((r) => {
      const due = dueDate(r.dueOffsetDays, r.dueHour);
      const row = { manualDoneAt: null, submittedAt: r.done ? due ?? now : null, submissionState: r.done ? (r.score != null ? "graded" : "submitted") : null, dueAt: due };
      return [r.canvasId, assignmentDoneReason(row, { type: typeOf(r), dueAt: due, zone: timeZone, now })] as const;
    }),
  );
  const activeRows = ROWS.filter((r) => doneReasonOf.get(r.canvasId) == null);
  const doneRows = ROWS.filter((r) => doneReasonOf.get(r.canvasId) != null);
  const courseGrade = (r: DemoRow) => {
    const score = COURSE_TOTAL[r.courseName]?.score;
    return score != null ? score / 100 : null;
  };

  // Run the demo coursework through the real planner + ranker (same calls, same
  // inputs as loadCalendarData) so plan / ranked / atRisk / overloadHours are all
  // genuine and the "do next" order matches what a real student would see.
  const allRows = activeRows.concat(doneRows);
  const totals = courseTotalPoints(allRows.map((r) => ({ courseCanvasId: COURSE_ID[r.courseName] ?? 0, pointsPossible: r.pointsPossible })));
  // Share of grade: the same rank-time rule live rows without a stored weight get
  // (Canvas group weights here; no syllabus scheme in the demo).
  const shareOf = fallbackGradeShares(
    allRows.map((r) => ({
      canvasId: r.canvasId,
      courseCanvasId: COURSE_ID[r.courseName] ?? 0,
      name: r.name,
      pointsPossible: r.pointsPossible,
      groupId: r.groupId ?? null,
      groupName: r.groupName ?? null,
      groupWeight: r.groupWeight ?? null,
      type: typeOf(r),
    })),
    new Map(),
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
      submissionType: r.submissionType,
      // The ONE effort rule (lib/effort): padded once, like live rows.
      estimatedEffortHours: effectiveEffort(r),
      courseGrade: courseGrade(r),
      gradeWeight: shareOf.get(r.canvasId) ?? null,
      latePolicy: null, // no stored policy = unknown, like a live course before it's read
      requiresAction: r.requiresAction ?? true,
    })),
    totals,
    EFFORT_HOURS,
    now,
    timeZone,
  );
  // Raw marginal value — passive / unopened items are ranked (importance 0) but
  // NEVER scheduled. Mirrors lib/calendarData.
  const valueOf = new Map(ranked.filter((r) => !r.locked && !r.passive).map((r) => [r.canvasId, r.value ?? 0]));

  // Same v1 week scheduler as live data (lib/weekPlan): spaced study sessions + ≤1h chunks.
  const assignments: SchedulerAssignment[] = activeRows
    .filter((r) => valueOf.has(r.canvasId))
    .map((r) => {
      const t = typeOf(r);
      return {
        canvasId: r.canvasId,
        name: r.name,
        courseName: r.courseName,
        dueAt: dueDate(r.dueOffsetDays, r.dueHour),
        pointsPossible: r.pointsPossible,
        htmlUrl: null,
        // What the plan budgets = what the tag shows (lib/effort, like live).
        estimatedEffortHours: effortOrDefault(r, EFFORT_HOURS),
        summary: r.summary ?? null,
        studyLeadDays: r.studyLeadDays ?? null,
        aiImportance: null,
        assessmentTier: isStudyType(t) ? assessmentTier(t, r.name) : null,
        value: valueOf.get(r.canvasId) ?? 0,
      };
    });

  const plan = generateWeekPlan(assignments, HOURS_PER_DAY, WINDOW_DAYS, EFFORT_HOURS, now, timeZone);

  const overdue = new Set(plan.atRisk.filter((r) => r.kind === "overdue").map((r) => r.canvasId));
  // Focus = the SAME slice live data uses (lib/rankActive.focusSlice): the top of
  // the value-first ranking, past due included, never passive/unopened.
  const recommendations = focusSlice(ranked);
  const rankedFlags = new Map(ranked.map((r) => [r.canvasId, r] as const));
  const reasonOf = new Map(ranked.map((r) => [r.canvasId, r.reason ?? null]));

  const toItem = (r: DemoRow, done: boolean): CalendarItem => {
    const due = dueDate(r.dueOffsetDays, r.dueHour);
    const type = typeOf(r);
    return {
      canvasId: r.canvasId,
      name: r.name,
      courseName: r.courseName,
      courseCanvasId: COURSE_ID[r.courseName] ?? 0,
      dueAt: due ? due.toISOString() : null,
      type,
      status: done ? "done" : overdue.has(r.canvasId) ? "overdue" : "normal",
      studyLeadDays: r.studyLeadDays ?? null,
      pointsPossible: r.pointsPossible,
      // Every row uses effortOrDefault, like live CalendarItems (passive + unopened too).
      estimatedEffortHours: effortOrDefault(r, EFFORT_HOURS),
      effortBucket: r.effortBucket ?? null,
      summary: r.summary ?? null,
      htmlUrl: null,
      score: r.score ?? null,
      groupId: r.groupId ?? null,
      groupName: r.groupName ?? null,
      groupWeight: r.groupWeight ?? null,
      manuallyDone: false, // demo has no persistence — checkoffs are disabled there
      locked: false,
      unlockAt: null,
      passive: rankedFlags.get(r.canvasId)?.passive ?? isPassiveItem({ requiresAction: r.requiresAction ?? true, submissionType: r.submissionType, type }),
      reason: reasonOf.get(r.canvasId) ?? null,
      doneReason: done ? (doneReasonOf.get(r.canvasId) ?? undefined) : undefined,
    };
  };

  const events: CalendarEvent[] = [
    { title: "Work shift", startTime: isoAt(0, 16), endTime: isoAt(0, 19), allDay: false, location: null, source: "google" },
    { title: "Study group", startTime: isoAt(2, 18), endTime: isoAt(2, 19), allDay: false, location: null, source: "google" },
  ];

  const data: CalendarData = {
    timeZone,
    todayYmd,
    lastCheckedAt: isoAt(0, 9),
    connected: true,
    syncedAt: isoAt(0, 9),
    validationStatus: "valid",
    stale: false,
    hoursPerDay: HOURS_PER_DAY,
    windowDays: WINDOW_DAYS,
    overloadHours: plan.overloadHours,
    items: activeRows.map((r) => toItem(r, false)),
    completed: doneRows.map((r) => toItem(r, true)),
    courses: [
      { canvasId: COURSE_ID[COURSE.science], name: COURSE.science, grade: gradeFor(COURSE.science, doneRows), latestAnnouncement: { title: "Lab moved to room 214 this week", postedAt: isoAt(0, 8) }, excluded: false },
      { canvasId: COURSE_ID[COURSE.math], name: COURSE.math, grade: gradeFor(COURSE.math, doneRows), latestAnnouncement: { title: "Problem Set 6 hint posted", postedAt: isoAt(-1, 16) }, excluded: false },
      { canvasId: COURSE_ID[COURSE.history], name: COURSE.history, grade: gradeFor(COURSE.history, doneRows), latestAnnouncement: { title: "Essay rubric updated — please re-read", postedAt: isoAt(-3, 11) }, excluded: false },
      // No announcement → the card simply omits the row.
      { canvasId: COURSE_ID[COURSE.english], name: COURSE.english, grade: gradeFor(COURSE.english, doneRows), latestAnnouncement: null, excluded: false },
    ],
    events,
    plan,
    atRisk: plan.atRisk.filter((r) => r.kind === "overdue"),
    recommendations,
    ranked,
  };

  return { data, todayYmd };
}

/** The course's honest grade state — the same deriveCourseGrade call live data
 *  makes: Canvas's total when shown, else "hidden" when anything is graded. */
function gradeFor(course: string, doneRows: DemoRow[]) {
  const total = COURSE_TOTAL[course];
  return deriveCourseGrade(total?.score, total?.letter, doneRows.some((r) => r.courseName === course && r.score != null));
}
