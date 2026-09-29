// Ticket #140 — UI audit round 1, Study + Assignment. Source guards so each fix
// can't be quietly undone, plus unit tests for the pure prompt builders.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import {
  buildStudyHubPrompt,
  buildDescriptionPrompt,
  buildAssignmentPlanPrompt,
  assignmentFacts,
  dayCount,
  inDays,
  TIMING_RULE,
  NO_GREETING_RULE,
  STUDY_HUB_INSTRUCTION,
  DEFAULT_ASSIGNMENT_PLAN_INSTRUCTION,
  CONFIDENCE_RULE,
  NO_INSTRUCTIONS_LINE,
} from "@/lib/briefing";
import { buildPlanPrompt, PLAN_TIMING_RULE, type AssessmentMeta } from "@/lib/study";
import { sanitizeBrief } from "@/lib/sanitizeBrief";
import { studyCoachCacheKey } from "@/components/studyUi";

const read = (p: string) => readFileSync(p, "utf8");
const VIEW = read("components/StudyView.tsx");
const UI = read("components/studyUi.tsx");
const TOOLS = read("components/StudyTools.tsx");
const ASSIGN = read("components/AssignmentPage.tsx");
const HUB_PAGE = read("app/(app)/study/page.tsx");
const TOOLS_PAGE = read("app/(app)/study/[canvasId]/page.tsx");
const SANITIZER = read("lib/sanitizeBrief.ts");

describe("1. due dates go through the shared zone-aware DueLabel", () => {
  it("Study hub, test page and assignment page render <DueLabel> with the agreed formats", () => {
    for (const src of [VIEW, TOOLS, ASSIGN]) expect(src).toMatch(/import \{ DueLabel \} from "@\/components\/DueLabel"/);
    expect(VIEW).toMatch(/<DueLabel[^>]*format="long-time"/);
    expect(TOOLS).toMatch(/<DueLabel[^>]*format="long-time"/);
    expect(ASSIGN).toMatch(/<DueLabel[^>]*format="long"[^>]*timeZone=\{zone\}[^>]*empty="No due date"/);
  });
  it("no local dueLabel() or server-zone ymd(new Date(iso)) left in these components", () => {
    for (const src of [VIEW, UI, TOOLS, ASSIGN]) {
      expect(src).not.toMatch(/\bdueLabel\(/);
      expect(src).not.toMatch(/ymd\(new Date\([^)]/); // ymd(new Date()) = "today" is fine; ymd(new Date(iso)) is not
      expect(src).not.toMatch(/new Date\(iso\)/); // sessionDateLabel's parseYmd(ymd string) is zone-free and fine
    }
  });
  it("the past-due badge uses isPastDue in the student's zone (#145: no mounted/UTC swap)", () => {
    expect(ASSIGN).toMatch(/import \{ isPastDue \} from "@\/lib\/dueLabel"/);
    expect(ASSIGN).not.toMatch(/useMounted\(\)/);
    expect(ASSIGN).toMatch(/isPastDue\(dueAt, \{ todayYmd, timeZone: zone \}\)/);
    // every DueLabel on the page is rendered in that zone
    const labels = ASSIGN.match(/<DueLabel\b[^>]*>/g) ?? [];
    expect(labels.length).toBeGreaterThanOrEqual(2);
    for (const l of labels) expect(l).toMatch(/timeZone=\{zone\}/);
  });
  it("the hub and test pages pass the STUDENT's day and zone down (lib/studentZone), never the server's", () => {
    for (const page of [HUB_PAGE, TOOLS_PAGE]) {
      expect(page).toContain("const todayYmd = dataToday(data);");
      expect(page).toContain("const timeZone = dataZone(data);");
      expect(page).toMatch(/todayYmd=\{todayYmd\}/);
      expect(page).toMatch(/timeZone=\{timeZone\}/);
      expect(page).not.toMatch(/ymd\(new Date\(/);
      // study sessions through the ONE rule (lib/study → lib/studyWeek.isStudySessionBlock), in that zone
      expect(page).toMatch(/studySessionsFor\(data\.plan, [a-zA-Z.]+, \{ todayYmd, zone: timeZone \}\)/);
    }
    // every due date on these pages renders in that zone
    for (const src of [VIEW, TOOLS]) {
      const labels = src.match(/<DueLabel [^>]*>/g) ?? [];
      expect(labels.length).toBeGreaterThan(0);
      for (const tag of labels) expect(tag).toContain("timeZone={timeZone}");
    }
  });
  it("the hub's coach-line cache turns over at the student's midnight, not the browser's", () => {
    expect(VIEW).toMatch(/studyCoachCacheKey\(\s*timeZone \? todayInZone\(timeZone\) : todayYmd,/);
    expect(VIEW).not.toMatch(/ymd\(new Date\(\)\)/);
  });
});

describe("2. accent surfaces use the on-accent token, not white", () => {
  it("no white text/fills on the violet hero, chips or tabs", () => {
    for (const src of [VIEW, UI, TOOLS]) {
      expect(src.match(/\btext-white\b/g) ?? []).toHaveLength(0);
      expect(src).not.toMatch(/\b(?:bg|ring|border)-white\b/);
    }
    expect(VIEW).toMatch(/bg-accent p-7 text-accent-on/);
    expect(TOOLS).toMatch(/bg-accent p-5 text-accent-on/);
    expect(TOOLS).toMatch(/"bg-accent text-accent-on"/);
    expect(UI).toMatch(/text-accent-on ring-1 ring-inset ring-accent-on\/25/);
  });
  it("no pale accent-ring focus rings (fails 3:1); tabs fall back to the global accent outline", () => {
    expect(TOOLS).not.toMatch(/focus-visible:ring-accent-ring/);
    const tab = TOOLS.slice(TOOLS.indexOf('role="tab"'), TOOLS.indexOf("</button>", TOOLS.indexOf('role="tab"')));
    expect(tab).not.toMatch(/focus-visible:(?:ring|outline-none)/);
  });
});

describe("3. practice questions and study hub accessibility", () => {
  it("answered choices stay focusable: aria-disabled instead of disabled", () => {
    const card = TOOLS.slice(TOOLS.indexOf("function QuestionCard("));
    expect(card).toMatch(/aria-disabled=\{done \|\| undefined\}/);
    expect(card).not.toMatch(/\sdisabled=\{done\}/);
  });
  it("verdict is a status region; the right answer is named in text, not colour alone", () => {
    const card = TOOLS.slice(TOOLS.indexOf("function QuestionCard("));
    expect(card).toContain('role="status"');
    expect(TOOLS).toContain('"Correct answer"');
    expect(TOOLS).toContain('"Your answer"');
  });
  it("short-answer input has a visible label tied to it", () => {
    expect(TOOLS).toMatch(/<label htmlFor=\{inputId\}/);
    expect(TOOLS).toMatch(/<input id=\{inputId\}/);
  });
  it("loading is a polite status, errors are alerts, tabs control labelled tabpanels", () => {
    const skel = TOOLS.slice(TOOLS.indexOf("function Skeleton("), TOOLS.indexOf("function ErrorBox("));
    expect(skel).toMatch(/role="status" aria-live="polite"/);
    expect(TOOLS.slice(TOOLS.indexOf("function ErrorBox("))).toMatch(/role="alert"/);
    expect(TOOLS).toMatch(/role="tabpanel"[^>]*aria-labelledby=\{tabId\(tab\)\}/);
    // aria-controls only points at the panel that is actually rendered
    expect(TOOLS).toMatch(/aria-controls=\{tab === t\.id \? panelId\(t\.id\) : undefined\}/);
  });
  it("the hub has a real <h1> and a live AI line", () => {
    expect(VIEW).toMatch(/<h1 className="text-xl font-semibold text-ink">Study<\/h1>/);
    expect(VIEW).toMatch(/role="status" aria-live="polite"/);
  });
});

describe("4. AI copy: grounded timing, no greeting, cached, no hedging", () => {
  it("the hub prompt carries the day-count rule and the no-greeting rule, and no name", () => {
    const p = buildStudyHubPrompt({
      count: 2,
      timeZone: "America/New_York",
      now: new Date("2026-09-27T16:00:00Z"),
      top: [{ name: "Quiz 4", courseName: "Micro", type: "quiz", dueAt: "2026-10-13T03:59:00Z" }],
    });
    expect(p).toContain("Today is Sunday, Sep 27.");
    expect(p).toContain("1. Quiz 4 (Micro) [Quiz] — due Mon, Oct 12 · 11:59 PM (in 15 days)");
    expect(p).toContain(TIMING_RULE);
    expect(p).toContain(NO_GREETING_RULE);
    expect(p).not.toContain("Calvin");
    expect(TIMING_RULE).toMatch(/never call anything imminent, urgent/i);
    expect(TIMING_RULE).toContain("within 3 days");
    expect(NO_GREETING_RULE).toMatch(/No greeting/);
    expect(NO_GREETING_RULE).toContain("take a deep breath");
    expect(STUDY_HUB_INSTRUCTION).not.toMatch(/reassure|warm/i);
  });

  it("day counts are exact calendar days", () => {
    expect(dayCount("2026-10-12", "2026-09-27")).toBe(15);
    expect(dayCount("2026-11-02", "2026-10-31")).toBe(2); // across the DST change
    expect([0, 1, -1, 15, -3].map(inDays)).toEqual(["today", "tomorrow", "yesterday", "in 15 days", "3 days ago"]);
  });

  const meta: AssessmentMeta = {
    canvasId: 1,
    name: "Quiz 4",
    courseName: "Micro",
    courseCanvasId: 9,
    type: "quiz",
    dueAt: new Date("2026-10-13T03:59:00Z"), // 11:59 PM Oct 12 in New York
    pointsPossible: 20,
    description: null,
    aiSummary: null,
    timeZone: "America/New_York",
  };

  const SEP27 = new Date("2026-09-27T16:00:00Z"); // noon in New York
  it("study plan: due and today are read in the student's zone (11:59 PM ET stays Oct 12); no day count (the plan is saved)", () => {
    const p = buildPlanPrompt(meta, [], undefined, SEP27);
    expect(p).toContain("The test is due Mon, Oct 12 · 11:59 PM.");
    expect(p).toContain("Due: Mon, Oct 12 · 11:59 PM");
    expect(p).not.toMatch(/\(in \d+ days\)/);
    expect(p).not.toContain(TIMING_RULE); // PLAN_TIMING_RULE replaces it
    const utc = buildPlanPrompt({ ...meta, timeZone: "UTC" }, [], undefined, SEP27);
    expect(utc).toContain("The test is due Tue, Oct 13 · 3:59 AM."); // what UTC alone would have said
  });
  it("study plan: 'sessions will appear' only when the lead time is > 0; no hedged planner facts", () => {
    expect(buildPlanPrompt({ ...meta, studyLeadDays: 3 }, [], undefined, SEP27)).toMatch(/starts study time 3 days before the test, so sessions will appear/);
    const zero = buildPlanPrompt({ ...meta, studyLeadDays: 0 }, [], undefined, SEP27);
    expect(zero).toContain("has set no study time ahead of this test");
    expect(zero).not.toMatch(/will appear/);
    const noLead = buildPlanPrompt(meta, [], undefined, SEP27);
    expect(noLead).not.toMatch(/will appear/);
    expect(noLead).not.toMatch(/may add some|depending on/);
    expect(noLead).toContain("No study sessions are scheduled right now.");
  });

  it("study plan: a test 15 days out with no sessions is NOT called imminent (the reported bug)", () => {
    const p = buildPlanPrompt(meta, [], undefined, SEP27);
    expect(p).toContain("Today is Sunday, Sep 27. The test is due Mon, Oct 12 · 11:59 PM.");
    expect(p).not.toMatch(/the test is imminent/i);
    expect(p).toContain("This is NOT last-minute.");
    expect(p).toContain(PLAN_TIMING_RULE);
    expect(p).toContain(NO_GREETING_RULE);
  });
  it("study plan: within 3 days and no sessions still gets the last-minute strategy", () => {
    const p = buildPlanPrompt(meta, [], undefined, new Date("2026-10-10T16:00:00Z"));
    expect(p).toContain("the test is within 3 days");
    expect(p).toContain("last-minute strategy");
  });
  it("study plan: the rules survive an admin-edited instruction", () => {
    const p = buildPlanPrompt(meta, [{ date: "2026-10-10", hours: 1 }], "CUSTOM VOICE", new Date("2026-10-01T16:00:00Z"));
    expect(p).toContain("CUSTOM VOICE");
    expect(p).toContain(PLAN_TIMING_RULE);
    expect(p).toContain(CONFIDENCE_RULE);
    expect(p).toContain("Also include 1-2 sentences of overall `advice`.");
    expect(p).toContain("the dates are ISO machine dates, YYYY-MM-DD"); // sessions = machine dates, due = display text
  });

  it("assignment approach: a brief → use only what it states; short or none → no guess prefix, nothing about the brief", () => {
    const base = { name: "Lab 3", courseName: "Chem", type: "assignment", points: 50, dueAt: "2026-10-13T03:59:00Z", timeZone: "America/New_York", now: SEP27 };
    const long = assignmentFacts({ ...base, brief: "Measure the boiling point of three solutions. ".repeat(8) });
    expect(long).toContain("Due Mon, Oct 12 · 11:59 PM (in 15 days).");
    expect(long).toContain("Assignment instructions from Canvas:");
    expect(long).toContain("Use only the requirements these instructions state.");

    const short = assignmentFacts({ ...base, brief: "See handout." });
    expect(short).toContain("See handout.");
    const beforeRules = (t: string) => t.slice(0, t.indexOf(CONFIDENCE_RULE)); // the rule itself names the banned words
    expect(beforeRules(short)).not.toMatch(/guess|short|thin/i);

    const none = assignmentFacts(base);
    expect(none).toContain(NO_INSTRUCTIONS_LINE);
    expect(beforeRules(none)).not.toMatch(/guess|brief/i);

    for (const p of [buildDescriptionPrompt(base), buildAssignmentPlanPrompt(base)]) {
      expect(p).toContain(TIMING_RULE);
      expect(p).toContain(NO_GREETING_RULE);
      expect(p).toContain(CONFIDENCE_RULE);
      expect(p).not.toMatch(/most likely involves/);
    }
    expect(DEFAULT_ASSIGNMENT_PLAN_INSTRUCTION).toContain("Start by…");
    expect(DEFAULT_ASSIGNMENT_PLAN_INSTRUCTION).not.toMatch(/likely/);
  });

  it("the hub caches the coach line for the session, keyed by a hash of its inputs", () => {
    expect(VIEW).toMatch(/sessionStorage\.getItem\(key\)/);
    expect(VIEW).toMatch(/sessionStorage\.setItem\(key, body\.summary\)/);
    expect(VIEW).toMatch(/studyCoachCacheKey\(/);
    expect(UI).toMatch(/export function studyCoachCacheKey\(todayYmd: string/);
  });
  it("the cache key changes with the day, the tests, or a moved due date — and only then", () => {
    const tests = [{ canvasId: 1, dueAt: "2026-10-12T23:59:00Z" }, { canvasId: 2, dueAt: null }];
    const k = studyCoachCacheKey("2026-09-27", tests);
    expect(k).toMatch(/^navo:study-coach:[0-9a-z]+$/);
    expect(studyCoachCacheKey("2026-09-27", tests.map((t) => ({ ...t })))).toBe(k);
    expect(studyCoachCacheKey("2026-09-28", tests)).not.toBe(k);
    expect(studyCoachCacheKey("2026-09-27", [tests[0]])).not.toBe(k);
    expect(studyCoachCacheKey("2026-09-27", [{ ...tests[0], dueAt: "2026-10-13T23:59:00Z" }, tests[1]])).not.toBe(k);
  });
});

describe("AI routes read the student's zone server-side; the demo never fetches the coach line", () => {
  it("the assignment page no longer sends a browser zone: the server reads the student's Canvas zone (#145)", () => {
    expect(ASSIGN).toMatch(/\/api\/assignment\/approach\?id=\$\{canvasId\}`/);
    expect(ASSIGN).not.toMatch(/resolvedOptions\(\)\.timeZone|&tz=/);
  });
  it("demo (prop, or anywhere under /demo) skips the fetch and the cache", () => {
    expect(VIEW).toMatch(/const isDemo = demo \|\| \(pathname \?\? ""\)\.startsWith\("\/demo"\)/);
    expect(VIEW).toMatch(/if \(isDemo \|\| !connected/);
  });
});

describe("5. wayfinding", () => {
  it("a test that's not in the plan redirects with ?missing=1 and the hub says so", () => {
    expect(TOOLS_PAGE).toContain('redirect("/study?missing=1")');
    expect(TOOLS_PAGE).not.toMatch(/if \(!assessment\) redirect\("\/study"\)/);
    expect(HUB_PAGE).toMatch(/missing=\{missing === "1"\}/);
    expect(VIEW).toContain("That test isn&apos;t in your plan anymore. Here&apos;s what&apos;s next.");
    expect(VIEW).toMatch(/window\.history\.replaceState\(null, "", "\/study"\)/);
  });
  it("the phone tab row fades out at the right edge while more tabs are off-screen", () => {
    expect(TOOLS).toMatch(/moreRight \? "max-md:\[-webkit-mask-image:linear-gradient/);
    expect(TOOLS).toMatch(/onScroll=\{updateMoreRight\}/);
    expect(TOOLS).toMatch(/nextIndex\(e\.key,/); // keyboard handling kept, via lib/keyboardNav
    expect(TOOLS).toMatch(/el\.scrollWidth - 6\)/); // ≥6px threshold
  });
});

describe("6. Canvas screen-reader text doesn't leak into the brief", () => {
  it("the sanitizer drops sr-only helpers via exclusiveFilter", () => {
    expect(SANITIZER).toMatch(/"screenreader-only"/);
    expect(SANITIZER).toMatch(/"ui-helper-hidden-accessible"/);
    expect(SANITIZER).toMatch(/exclusiveFilter: \(frame\) =>/);
    expect(SANITIZER).toMatch(/tagName === "span" &&/); // spans only
    expect(SANITIZER).not.toMatch(/"sr-only"|"visually-hidden"/); // never a teacher's own classes
    expect(sanitizeBrief('<a href="https://x.test">Syllabus<span class="screenreader-only">Links to an external site.</span></a>')).not.toContain("external site");
  });
});

describe("7. copy: no arrow glyphs appended to link text in these files", () => {
  it("no → / ← / ↗ in Study or Assignment link labels", () => {
    const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); // comments may say "→"
    for (const src of [VIEW, TOOLS, ASSIGN]) expect(code(src)).not.toMatch(/[→←↗]/);
  });
  it("no ALL-CAPS eyebrow labels", () => {
    for (const src of [VIEW, TOOLS, ASSIGN]) expect(src).not.toMatch(/\buppercase tracking-wider\b/);
  });
});
