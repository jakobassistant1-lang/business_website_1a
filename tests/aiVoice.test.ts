// #145 — ONE confident voice for every student-facing AI prompt, fed the same facts
// the screen shows. Behaviour first: what each prompt builder actually hands the
// model (rules present, no hedges, no "unknown"/"?" placeholders, clean course
// names, type labels, importance order, dates in the student's Canvas zone), then
// the assignment page's always-present Canvas instructions section. No live
// Gemini: the one route test mocks the Gemini transport and reads the prompt.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/access", () => ({ requireActiveUser: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { assignment: { findMany: vi.fn(), update: vi.fn() } } }));
vi.mock("@/lib/calendarData", () => ({ loadCalendarData: vi.fn() }));
vi.mock("@/lib/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/settings")>()),
  getSetting: vi.fn(async () => null),
}));
vi.mock("@/lib/geminiFetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/geminiFetch")>()),
  geminiKey: () => "test-key",
  geminiPost: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ back() {}, push() {}, refresh() {} }) }));
vi.mock("@/components/calendar/parts", () => ({ EffortTag: () => null, EffortEditor: () => null, MarkDoneButton: () => null }));

import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// vitest compiles the .tsx component with the classic JSX runtime (React.createElement).
(globalThis as { React?: typeof React }).React = React;
import {
  CONFIDENCE_RULE,
  NO_GREETING_RULE,
  TIMING_RULE,
  WORDING_RULE,
  VOICE_RULES,
  NO_INSTRUCTIONS_LINE,
  buildPrompt,
  buildPeriodPrompt,
  buildStudyHubPrompt,
  buildDescriptionPrompt,
  buildAssignmentPlanPrompt,
  buildDashboardPrompt,
  promptItemLine,
  DEFAULT_BRIEFING_INSTRUCTION,
  DEFAULT_PERIOD_COACH_INSTRUCTION,
  STUDY_HUB_INSTRUCTION,
  DEFAULT_ASSIGNMENT_PLAN_INSTRUCTION,
  DASHBOARD_SUMMARY_INSTRUCTION,
  type PromptItem,
} from "@/lib/briefing";
import {
  buildPlanPrompt,
  buildGuidePrompt,
  buildQuestionsPrompt,
  PLAN_TIMING_RULE,
  CONTENT_RULE,
  DEFAULT_STUDY_PLAN_INSTRUCTION,
  DEFAULT_STUDY_GUIDE_INSTRUCTION,
  DEFAULT_STUDY_QUESTIONS_INSTRUCTION,
  type AssessmentMeta,
  type StudyMaterial,
} from "@/lib/study";
import { buildAnalysisPrompt, hasHedge, needsAnalysis, analysisInputHash, type AnalyzableRow } from "@/lib/analysis";
import { runAnalysis } from "@/lib/analysisStore";
import { prisma } from "@/lib/prisma";
import { requireActiveUser } from "@/lib/access";
import { loadCalendarData } from "@/lib/calendarData";
import { geminiPost } from "@/lib/geminiFetch";
import { GET as periodCoachGET } from "@/app/api/calendar/briefing/route";
import { GET as dashboardGET } from "@/app/api/dashboard-summary/route";
import { AssignmentPage } from "@/components/AssignmentPage";

type Fn = ReturnType<typeof vi.fn>;
const m = (f: unknown) => f as Fn;

const ZONE = "America/New_York";
const NOW = new Date("2026-09-28T16:00:00Z"); // Monday noon in New York
// 11:59 PM Wed Sep 30 in New York — already Oct 1 in UTC.
const DUE_SEP30_ET = "2026-10-01T03:59:00Z";

/** Everything but the rule text itself (the rule NAMES the banned words). */
function withoutRules(p: string): string {
  let out = p;
  for (const r of [...VOICE_RULES, PLAN_TIMING_RULE, CONTENT_RULE]) out = out.split(r).join("");
  return out;
}

// Case-aware on purpose: "May 4" (a date) and "Unknown Compounds Lab" (a title)
// are facts copied as given, not hedges.
const HEDGES: RegExp[] = [
  /\b(likely|probably|possibly|might|may|seems|appears|perhaps|unknown)\b/,
  /I think|it looks like|this is a guess|the brief is short|not specified|unclear/i,
  /\bguess/i,
];
function expectNoHedges(p: string) {
  const body = withoutRules(p);
  for (const re of HEDGES) expect(body, `${re} in:\n${body}`).not.toMatch(re);
}

const material = (sparse: boolean): StudyMaterial => ({
  sources: sparse ? [] : [{ kind: "description", title: "Test instructions", text: "Covers chapters 1-3: supply and demand." }],
  moduleName: null,
  sparse,
  excluded: [],
  aiFiltered: false,
  hash: "h",
});
const meta = (over: Partial<AssessmentMeta> = {}): AssessmentMeta => ({
  canvasId: 1,
  name: "Quiz 4",
  courseName: "2026F-01:MANAGERIAL ECONOMICS",
  courseCanvasId: 9,
  type: "quiz",
  dueAt: new Date(DUE_SEP30_ET),
  pointsPossible: 20,
  description: null,
  aiSummary: null,
  timeZone: ZONE,
  ...over,
});
const item = (over: Partial<PromptItem> = {}): PromptItem => ({
  name: "Problem Set 2",
  courseName: "2026F-01:MANAGERIAL ECONOMICS",
  type: "other",
  dueAt: DUE_SEP30_ET,
  points: 50,
  effortHours: 2,
  ...over,
});
const assignment = { name: "Lab 3", courseName: "2026F-02:CHEM 101", type: "assignment", points: 50, dueAt: DUE_SEP30_ET, timeZone: ZONE, now: NOW };
const load = { dueThisWeek: 3, examQuiz: 1, workHours: 10, budgetHours: 21, overloadHours: 0, overdueCount: 2, overdueHours: 3 };

/** Every exported student-facing builder, fully populated and with facts missing. */
function allPrompts(missing: boolean): Record<string, string> {
  const it = missing ? item({ dueAt: null, points: null, effortHours: null }) : item();
  const m1 = missing ? meta({ dueAt: null, pointsPossible: null }) : meta();
  const a = missing ? { ...assignment, dueAt: null, points: null } : { ...assignment, brief: "Measure three solutions." };
  return {
    legacyBriefing: buildPrompt({ windowDays: 7, inWindowDueCount: 3, atRiskCount: 1, top: [] }),
    periodCoach: buildPeriodPrompt({ period: "week", rangeLabel: "Sep 28–Oct 4", dueCount: 1, pastDueCount: 0, busyHours: 0, top: [it], timeZone: ZONE, now: NOW }),
    studyHub: buildStudyHubPrompt({ count: 1, top: [{ ...it, type: "quiz" }], timeZone: ZONE, now: NOW }),
    description: buildDescriptionPrompt(a),
    approach: buildAssignmentPlanPrompt(a),
    approachCustom: buildAssignmentPlanPrompt(a, "CUSTOM ADMIN VOICE"),
    dashboard: buildDashboardPrompt({ ...load, windowDays: 7, top: [it], timeZone: ZONE, now: NOW }),
    studyPlan: buildPlanPrompt(m1, [], "CUSTOM ADMIN VOICE", NOW),
    studyGuide: buildGuidePrompt(m1, material(missing), "CUSTOM ADMIN VOICE"),
    questionsMcq: buildQuestionsPrompt(m1, material(missing), "multiple_choice"),
    questionsTf: buildQuestionsPrompt(m1, material(missing), "true_false"),
    questionsShort: buildQuestionsPrompt(m1, material(missing), "short_answer"),
    analysisSummary: buildAnalysisPrompt([
      { canvasId: 7, name: "Essay", courseName: "2026F-01:MANAGERIAL ECONOMICS", pointsPossible: missing ? null : 100, dueAt: missing ? null : DUE_SEP30_ET, description: null },
    ], ZONE),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const COACHING = ["legacyBriefing", "periodCoach", "studyHub", "description", "approach", "approachCustom", "dashboard"];
const CONTENT = ["studyGuide", "questionsMcq", "questionsTf", "questionsShort"];

describe("one voice for COACHING copy; plain-fact rules for study CONTENT", () => {
  for (const missing of [false, true]) {
    it(`each builder carries exactly its rule set (${missing ? "facts missing" : "full facts"}), even with an admin instruction`, () => {
      const all = allPrompts(missing);
      for (const name of COACHING) for (const r of VOICE_RULES) expect(all[name], name).toContain(r);
      // The saved study plan: the coaching voice, but PLAN_TIMING_RULE (dates, never counts).
      for (const r of [CONFIDENCE_RULE, NO_GREETING_RULE, WORDING_RULE, PLAN_TIMING_RULE]) expect(all.studyPlan).toContain(r);
      expect(all.studyPlan).not.toContain(TIMING_RULE);
      // Guides and questions: only WORDING_RULE + CONTENT_RULE — no word ban, no
      // "never ask a question", no "open with the next action".
      for (const name of CONTENT) {
        expect(all[name], name).toContain(WORDING_RULE);
        expect(all[name], name).toContain(CONTENT_RULE);
        for (const r of [CONFIDENCE_RULE, NO_GREETING_RULE, TIMING_RULE]) expect(all[name], name).not.toContain(r);
      }
      // The stored one-line summary: confidence + wording only.
      expect(all.analysisSummary).toContain(CONFIDENCE_RULE);
      expect(all.analysisSummary).toContain(WORDING_RULE);
      for (const r of [NO_GREETING_RULE, TIMING_RULE]) expect(all.analysisSummary).not.toContain(r);
    });
  }

  it("the confidence rule says what the owner asked for, and protects titles and dates", () => {
    expect(CONFIDENCE_RULE).toMatch(/never say or imply that you are guessing, unsure, or missing information/i);
    for (const w of ["likely", "probably", "possibly", "might", "may", "seems", "appears", "perhaps", "I think", "it looks like", "this is a guess", "the brief is short", "not specified", "unclear"]) {
      expect(CONFIDENCE_RULE).toContain(w);
    }
    expect(CONFIDENCE_RULE).toMatch(/to express doubt/);
    expect(CONFIDENCE_RULE).toMatch(/Assignment titles, course names and dates are facts: always copy them exactly as given/);
    expect(CONFIDENCE_RULE).toMatch(/If a fact is not given, do not mention it at all/);
    expect(CONFIDENCE_RULE).toMatch(/Never apologise, never mention being an AI, and never ask the student a question/);
  });

  it("a title with 'Unknown' and a May date reach the model verbatim and are not hedges", () => {
    const p = buildAssignmentPlanPrompt({ ...assignment, name: "Unknown Compounds Lab", dueAt: "2027-05-05T03:59:00Z", brief: "" });
    expect(p).toContain('"Unknown Compounds Lab"');
    expect(p).toContain("Tue, May 4 · 11:59 PM");
    expectNoHedges(p);
  });

  it("no coaching output or default instruction contains a hedge (outside the rule text itself)", () => {
    for (const missing of [false, true]) {
      const all = allPrompts(missing);
      for (const name of [...COACHING, "studyPlan", "analysisSummary"]) expectNoHedges(all[name]);
    }
    for (const ins of [
      DEFAULT_BRIEFING_INSTRUCTION,
      DEFAULT_PERIOD_COACH_INSTRUCTION,
      STUDY_HUB_INSTRUCTION,
      DEFAULT_ASSIGNMENT_PLAN_INSTRUCTION,
      DASHBOARD_SUMMARY_INSTRUCTION,
      DEFAULT_STUDY_PLAN_INSTRUCTION,
      DEFAULT_STUDY_GUIDE_INSTRUCTION,
      DEFAULT_STUDY_QUESTIONS_INSTRUCTION,
    ]) {
      expectNoHedges(ins);
      expect(ins).not.toMatch(/\bwarm\b/i);
    }
  });

  it("missing due date / points / brief: the lines are absent — never 'unknown', '?', 'none' or a remark on the brief", () => {
    for (const [name, p] of Object.entries(allPrompts(true))) {
      const body = withoutRules(p);
      expect(body, name).not.toMatch(/\?/);
      expect(body, name).not.toMatch(/\bunknown\b|\bnone\b|undefined|null|NaN/i);
      expect(body, name).not.toMatch(/\b[Dd]ue:? (Mon|Tue|Wed|Thu|Fri|Sat|Sun|20\d\d)/); // no due fact at all
      expect(body, name).not.toMatch(/Points:|\bpts\b|Worth \d/); // no points fact at all
    }
  });

  it("no Canvas instructions: the exact 'only true steps' line, nothing about a brief", () => {
    expect(NO_INSTRUCTIONS_LINE).toBe(
      "Only the title, course, type, points and due date are known. Treat anything the title states (a time limit, a " +
        "submission step) as a given fact and build the steps from it, for example when to open it and how much time to " +
        "block before the due time. Every step must be true from these facts alone. Never invent topics, readings, problems " +
        "or requirements. Fewer, true steps beat more, invented ones.",
    );
    for (const p of [buildAssignmentPlanPrompt({ ...assignment, brief: "" }), buildDescriptionPrompt(assignment)]) {
      expect(p).toContain(NO_INSTRUCTIONS_LINE);
      expect(withoutRules(p)).not.toMatch(/\bbrief\b|\bthin\b|is short|guess|fit this kind of work/i);
    }
    expect(DEFAULT_ASSIGNMENT_PLAN_INSTRUCTION).toContain("Be specific to the instructions (when given), the title and the type");
    // With instructions, the line is absent.
    expect(buildAssignmentPlanPrompt({ ...assignment, brief: "Measure three solutions." })).not.toContain(NO_INSTRUCTIONS_LINE);
  });

  it("no name, no 'Student:' line; coaching says 'course' and 'past due'", () => {
    const all = allPrompts(false);
    for (const name of [...COACHING, "studyPlan"]) {
      const body = withoutRules(all[name]);
      expect(body).not.toMatch(/Student:|Calvin|Maya/);
      expect(body).not.toMatch(/\boverdue\b/i);
      expect(body).not.toMatch(/\bclass\b/i);
    }
    expect(all.dashboard).toContain("Past due and still not submitted: 2");
  });
});

describe("study CONTENT is never word-restricted", () => {
  const probability = (): StudyMaterial => ({
    sources: [{ kind: "description", title: "Test instructions", text: "Unit 4: which outcome is more likely; possible events; the unknown parameter p may be estimated." }],
    moduleName: null,
    sparse: false,
    excluded: [],
    aiFiltered: false,
    hash: "p",
  });
  const statsMeta = meta({ name: "Probability Midterm", type: "exam", courseName: "2026F-03:STATISTICS" });

  it("a Probability guide prompt carries NO word ban, and the subject vocabulary reaches the model intact", () => {
    const p = buildGuidePrompt(statsMeta, probability());
    expect(p).not.toContain(CONFIDENCE_RULE);
    expect(p).not.toMatch(/Never hedge|do not use likely/);
    expect(p).toContain("which outcome is more likely; possible events; the unknown parameter p may be estimated.");
    expect(p).toContain(CONTENT_RULE);
  });

  it("a practice-questions prompt may ask questions (no 'never ask the student a question', no 'open with the next action')", () => {
    for (const t of ["multiple_choice", "true_false", "short_answer"] as const) {
      const p = buildQuestionsPrompt(statsMeta, probability(), t);
      expect(p).not.toContain("never ask the student a question");
      expect(p).not.toContain(NO_GREETING_RULE);
      expect(p).toContain("questions a student should be able to answer");
      expect(p).toContain(CONTENT_RULE);
    }
  });
});

describe("the facts match the screen", () => {
  it("clean course name, type label, zone-correct date, one '~' on the effort", () => {
    const line = promptItemLine(item(), ZONE, NOW);
    expect(line).toBe("Problem Set 2 (MANAGERIAL ECONOMICS) [Task] — due Wed, Sep 30 · 11:59 PM (in 2 days), 50 pts, effort ~2h");
    expect(line).not.toContain("~~");
    expect(line).not.toContain("2026F-01");
    // Sub-hour effort reads as minutes, still one "~".
    expect(promptItemLine(item({ effortHours: 0.5 }), ZONE, NOW)).toContain("effort ~30m");
  });

  it("the study guide / questions get the same clean facts, with the due date as display text (no count: they're saved)", () => {
    const p = buildGuidePrompt(meta(), material(false));
    expect(p).toContain("Assessment: Quiz 4 (Quiz)");
    expect(p).toContain("Course: MANAGERIAL ECONOMICS");
    expect(p).toContain("Due: Wed, Sep 30 · 11:59 PM\n");
    expect(p).toContain("Points: 20");
  });

  it("the study plan: the due date without a day count; session dates flagged as ISO machine dates", () => {
    const p = buildPlanPrompt(meta(), [{ date: "2026-09-29", hours: 1 }], undefined, NOW);
    expect(p).toContain("The test is due Wed, Sep 30 · 11:59 PM.");
    expect(p).not.toMatch(/\(in \d+ days?\)|\(tomorrow\)/);
    expect(p).toContain("the dates are ISO machine dates, YYYY-MM-DD");
    expect(p).toContain("1. 2026-09-29 — 1h");
  });

  it("the analysis prompt: clean course, the due DAY in the student's zone, missing values omitted", () => {
    const p = buildAnalysisPrompt([{ canvasId: 7, name: "Essay", courseName: "2026F-01:MANAGERIAL ECONOMICS", pointsPossible: null, dueAt: DUE_SEP30_ET, description: null }], ZONE);
    expect(p).toContain("#7 | Essay | MANAGERIAL ECONOMICS | due 2026-09-30");
    expect(p).not.toContain("? pts");
  });
});

describe("analysis: only ACTIVE rows with a hedged stored summary re-run (no version bump)", () => {
  const base = (over: Partial<AnalyzableRow> = {}): AnalyzableRow => {
    const r: AnalyzableRow = { canvasId: 1, name: "Lab 3", courseName: "Chem", pointsPossible: 50, dueAt: null, description: null, analyzedAt: new Date("2026-09-01"), analysisHash: null, ...over };
    return { ...r, analysisHash: analysisInputHash(r) };
  };

  it("hasHedge is case-aware for 'may' (a May date is not a hedge)", () => {
    expect(hasHedge("This likely covers chapter 3.")).toBe(true);
    expect(hasHedge("Likely a short lab.")).toBe(true);
    expect(hasHedge("You may need the handout.")).toBe(true);
    expect(hasHedge("Submit the May 4 lab report on the Unknown Compounds Lab.")).toBe(false);
    expect(hasHedge(null)).toBe(false);
  });

  it("needsAnalysis: an analyzed row re-runs only when it is active AND its summary hedges", () => {
    expect(needsAnalysis(base({ aiSummary: "Write the lab report.", active: true }))).toBe(false);
    expect(needsAnalysis(base({ aiSummary: "This probably involves a report.", active: true }))).toBe(true);
    expect(needsAnalysis(base({ aiSummary: "This probably involves a report.", active: false }))).toBe(false);
    expect(needsAnalysis(base({ aiSummary: "This probably involves a report." }))).toBe(false); // activity unknown → leave it
  });

  const dbRow = (canvasId: number, summary: string, done: boolean) => {
    const r = base({ canvasId, name: `Item ${canvasId}` });
    return {
      canvasId, name: r.name, course: { name: "Chem" }, user: { timeZone: ZONE }, pointsPossible: 50, dueAt: null, description: null,
      analyzedAt: r.analyzedAt, analysisHash: r.analysisHash, aiSummary: summary, submissionType: "online_upload",
      manualDoneAt: null, submittedAt: done ? new Date("2026-09-20") : null, submissionState: done ? "submitted" : null,
    };
  };
  const answer = (id: number, summary: string) => ({
    res: { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify([{ id, hours: 9, bucket: "long", summary, importance: 5, requiresAction: true }]) }] } }] }) },
    timedOut: false,
  });

  it("runAnalysis sends ONLY the active hedged row, rewrites ONLY its summary, and never stores a hedge", async () => {
    m(prisma.assignment.findMany).mockResolvedValue([dbRow(1, "Write the lab report.", false), dbRow(2, "This likely involves a report.", false), dbRow(3, "It seems short.", true)]);
    m(prisma.assignment.update).mockResolvedValue({});
    m(geminiPost).mockResolvedValue(answer(2, "Write a two-page report on the titration results."));
    expect(await runAnalysis(7)).toMatchObject({ analyzed: 1, remaining: 0, done: true });
    expect(m(geminiPost)).toHaveBeenCalledTimes(1);
    const prompt: string = m(geminiPost).mock.calls[0][1].contents[0].parts[0].text;
    expect(prompt).toContain("#2 | Item 2");
    expect(prompt).not.toMatch(/#1 \||#3 \|/);
    const { data } = m(prisma.assignment.update).mock.calls[0][0];
    expect(Object.keys(data).sort()).toEqual(["aiSummary", "analyzedAt"]); // effort/importance untouched
    expect(data.aiSummary).toBe("Write a two-page report on the titration results.");

    // Still hedged on the re-run → cleared, not stored (so it can't loop).
    m(prisma.assignment.update).mockClear();
    m(geminiPost).mockResolvedValue(answer(2, "This probably involves a report."));
    await runAnalysis(7);
    expect(m(prisma.assignment.update).mock.calls[0][0].data.aiSummary).toBeNull();
  });
});

describe("GET /api/calendar/briefing (period coach) — what reaches the model", () => {
  const ranked = [{ canvasId: 3 }, { canvasId: 1 }, { canvasId: 2 }]; // importance order ≠ due order
  const it_ = (canvasId: number, name: string, dueAt: string, over: Record<string, unknown> = {}) => ({
    canvasId,
    name,
    courseName: "2026F-01:MANAGERIAL ECONOMICS",
    dueAt,
    type: "other",
    status: "normal",
    pointsPossible: 10,
    estimatedEffortHours: 2,
    ...over,
  });

  beforeEach(() => {
    m(requireActiveUser).mockResolvedValue({ id: 42, fullName: "Calvin Test", timeZone: ZONE });
    m(geminiPost).mockResolvedValue({
      res: { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "Start the problem set tonight." }] } }] }) },
      timedOut: false,
    });
    m(loadCalendarData).mockResolvedValue({
      connected: true,
      events: [],
      ranked,
      items: [
        it_(1, "Earliest due", "2026-09-29T15:00:00Z"),
        it_(2, "Middle due", DUE_SEP30_ET, { type: "quiz" }),
        it_(3, "Most important", "2026-10-02T15:00:00Z", { type: "exam", pointsPossible: 100 }),
        it_(4, "Next month", "2026-11-20T15:00:00Z"),
      ],
    });
  });

  it("sends the items in the app's importance order, with clean names, type labels and dates in the student's zone", async () => {
    const res = await periodCoachGET(new Request("http://x/api/calendar/briefing?view=week&start=2026-09-28"));
    expect((await res.json()).text).toBe("Start the problem set tonight.");
    const prompt: string = m(geminiPost).mock.calls[0][1].contents[0].parts[0].text;

    const order = ["Most important", "Earliest due", "Middle due"].map((n) => prompt.indexOf(`. ${n} (`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b)); // ranked, not chronological
    expect(prompt).toContain("in the app's importance order");
    expect(prompt).not.toMatch(/most urgent first/i);
    expect(prompt).not.toContain("Next month"); // outside the week

    expect(prompt).toContain("1. Most important (MANAGERIAL ECONOMICS) [Exam]");
    expect(prompt).toContain("2. Earliest due (MANAGERIAL ECONOMICS) [Task]");
    expect(prompt).not.toContain("2026F-01");
    expect(prompt).not.toContain("[other]");
    // 2026-10-01T03:59Z is 11:59 PM Sep 30 for a New York student.
    expect(prompt).toContain("3. Middle due (MANAGERIAL ECONOMICS) [Quiz] — due Wed, Sep 30 · 11:59 PM (in 2 days)");
    expect(prompt).not.toMatch(/Oct 1\b/);
    expect(prompt).toContain("Today is Monday, Sep 28.");
    expect(prompt).toContain("effort ~2h");
    expect(prompt).not.toContain("~~");
    expect(prompt).not.toMatch(/Student:|Calvin/);
    expect(prompt).toContain(CONFIDENCE_RULE);
  });

  it("the zone is the student's Canvas zone, not a client value", async () => {
    m(requireActiveUser).mockResolvedValue({ id: 43, fullName: "X", timeZone: "UTC" });
    await periodCoachGET(new Request("http://x/api/calendar/briefing?view=week&start=2026-09-28&tz=America%2FNew_York"));
    const prompt: string = m(geminiPost).mock.calls[0][1].contents[0].parts[0].text;
    expect(prompt).toContain("Middle due (MANAGERIAL ECONOMICS) [Quiz] — due Thu, Oct 1 · 3:59 AM");
  });
});

describe("GET /api/dashboard-summary — what reaches the model", () => {
  it("top priorities in the app's importance order, with the facts from the items and no name", async () => {
    m(requireActiveUser).mockResolvedValue({ id: 50, fullName: "Calvin Test", timeZone: ZONE });
    m(geminiPost).mockResolvedValue({
      res: { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"points":["Finish the lab."],"intensity":"moderate"}' }] } }] }) },
      timedOut: false,
    });
    m(loadCalendarData).mockResolvedValue({
      plan: { days: [{ date: "2026-09-28", allocated: 2 }] },
      hoursPerDay: 3,
      overloadHours: 0,
      items: [
        { canvasId: 1, name: "Lab 3", courseName: "2026F-02:CHEM 101", dueAt: DUE_SEP30_ET, type: "assignment", status: "normal", pointsPossible: 50, estimatedEffortHours: 2.2 },
        { canvasId: 2, name: "Quiz 1", courseName: "Bio", dueAt: "2026-09-29T15:00:00Z", type: "quiz", status: "normal", pointsPossible: 10, estimatedEffortHours: 1 },
      ],
      recommendations: [
        { canvasId: 1, name: "Lab 3", courseName: "2026F-02:CHEM 101", reason: "Due in 1 day · 50 pts", score: 90, htmlUrl: null },
        { canvasId: 2, name: "Quiz 1", courseName: "Bio", reason: "Due in 1 day · 10 pts", score: 40, htmlUrl: null },
      ],
    });
    await dashboardGET();
    const prompt: string = m(geminiPost).mock.calls[0][1].contents[0].parts[0].text;
    expect(prompt).toContain("1. Lab 3 (CHEM 101) [Assignment] — due Wed, Sep 30 · 11:59 PM (in 2 days), 50 pts, effort ~2.2h");
    expect(prompt).toContain("2. Quiz 1 (Bio) [Quiz] — due Tue, Sep 29");
    expect(prompt).not.toContain("Due in 1 day"); // the ranking's reason strings are not echoed
    expect(prompt).not.toMatch(/Student:|Calvin|\bwarm\b/);
  });
});

describe("AssignmentPage: the Canvas instructions section, always, under the AI section", () => {
  const base = {
    canvasId: 5,
    name: "Lab 3",
    courseName: "2026F-02:CHEM 101",
    type: "assignment" as const,
    dueAt: DUE_SEP30_ET,
    points: 50,
    htmlUrl: "https://canvas.test/courses/1/assignments/5",
    safeHtml: null as string | null,
    submissionState: null,
    submittedAt: null,
    submissionScore: null,
    summary: "Start by measuring three solutions.",
    todayYmd: "2026-09-28",
    timeZone: ZONE,
  };
  const render = (over: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(AssignmentPage, { ...base, ...over }));
  const text = (html: string) => html.replace(/<[^>]+>/g, "");

  it("with Canvas instructions: rendered word-for-word, directly after 'How to approach this'", () => {
    const html = render({ safeHtml: "<p>Measure <strong>three</strong> solutions and record the boiling points.</p>" });
    expect(html).toContain("Canvas instructions");
    expect(html).toContain("<p>Measure <strong>three</strong> solutions and record the boiling points.</p>");
    expect(html.indexOf("How to approach this")).toBeGreaterThan(-1);
    expect(html.indexOf("How to approach this")).toBeLessThan(html.indexOf("Canvas instructions"));
    expect(html).not.toContain("hasn’t added instructions");
  });

  it("without instructions: one plain line plus the Open in Canvas action", () => {
    const html = render({ safeHtml: null });
    expect(html).toContain("Canvas instructions");
    expect(text(html)).toContain("Your teacher hasn’t added instructions in Canvas.");
    const section = html.slice(html.indexOf("Canvas instructions"));
    expect(section).toContain("Open in Canvas");
  });

  it("not open yet: 'Not open yet. Opens {date}.' in the student's zone, and no plan is being worked out", () => {
    const html = render({ safeHtml: null, summary: null, opensAt: "2026-10-01T03:59:00Z" });
    expect(text(html)).toContain("Not open yet. Opens Wed, Sep 30 · 11:59 PM.");
    expect(text(html)).not.toContain("hasn’t added instructions");
    expect(html).not.toContain("Working out a plan");
    expect(html).toContain("Canvas instructions");
  });

  it("not open yet WITH a stored summary: no 'How to approach this' at all", () => {
    const html = render({ summary: "Start by measuring three solutions.", opensAt: "2026-10-01T03:59:00Z" });
    expect(html).not.toContain("How to approach this");
    expect(html).not.toContain("Start by measuring three solutions.");
    expect(text(html)).toContain("Not open yet. Opens Wed, Sep 30 · 11:59 PM.");
  });

  it("the done badge comes only from the page's decision (a reopened submission is not 'Submitted')", () => {
    const reopened = render({ submissionState: "unsubmitted", submittedAt: "2026-09-20T12:00:00Z", done: false, doneReason: null });
    expect(text(reopened)).not.toContain("Submitted");
    expect(text(render({ done: true, doneReason: "submitted" }))).toContain("Submitted");
    expect(text(render({ done: true, doneReason: "graded", submissionScore: 45 }))).toContain("Graded · 45/50 pts");
  });

  it("the header date and past-due badge are read in the student's zone (no UTC swap)", () => {
    const html = render({ dueAt: "2026-09-28T03:59:00Z", done: false, doneReason: null }); // 11:59 PM Sep 27 ET
    expect(text(html)).toContain("Past due · Sunday, Sep 27");
    expect(text(html)).toContain("Not submitted, past due");
    expect(text(render({ done: true, doneReason: "date_passed" }))).toContain("Date passed");
  });
});
