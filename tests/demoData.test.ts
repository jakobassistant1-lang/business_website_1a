import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { buildDemoCalendarData } from "@/lib/demoData";
import { isStudySessionBlock } from "@/lib/studyWeek";
import { DEFAULT_STUDENT_ZONE, todayInZone } from "@/lib/studentZone";
import { ymdInZone } from "@/lib/calendarDates";
import { courseCounts } from "@/lib/courseCounts";

// Fixed "now" → deterministic assertions.
const NOW = new Date("2026-06-15T08:00:00.000Z");

describe("buildDemoCalendarData", () => {
  const { data, todayYmd } = buildDemoCalendarData(NOW);

  it("returns a connected, fully-populated CalendarData", () => {
    expect(data.connected).toBe(true);
    expect(data.validationStatus).toBe("valid");
    expect(typeof data.overloadHours).toBe("number");
    expect(data.items.length).toBeGreaterThanOrEqual(10);
    expect(data.completed.length).toBeGreaterThanOrEqual(1);
    expect(todayYmd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("covers exactly the four demo subjects", () => {
    const subjects = new Set(data.items.map((i) => i.courseName.split(" · ")[0]));
    expect(subjects).toEqual(new Set(["Science", "Math", "History", "English"]));
  });

  it("produces a real 7-day plan with study sessions (the one isStudySessionBlock rule)", () => {
    expect(data.plan.days).toHaveLength(7);
    const hasSession = data.plan.days.some((d) => d.blocks.some((b) => isStudySessionBlock(b, todayYmd, data.timeZone!)));
    expect(hasSession).toBe(true);
  });

  it("ranks work, surfaces a Focus slice and a past-due item", () => {
    expect(data.ranked.length).toBeGreaterThan(0);
    expect(data.recommendations.length).toBeGreaterThan(0);
    expect(data.recommendations.length).toBeLessThanOrEqual(3);
    // Biology "Lab Report 2" is due in the past → past due, in atRisk (the catch-up rail).
    expect(data.atRisk.length).toBeGreaterThanOrEqual(1);
    expect(data.atRisk.every((r) => r.kind === "overdue")).toBe(true);
  });

  it("orders the demo do-next list by the value-first prioritizer and the live Focus rule (focusSlice)", () => {
    // The demo runs through rankActiveRows (marginal value), exactly like live data,
    // so `ranked` is non-increasing by score, and recommendations are the top of it
    // with importance > 0 that aren't passive/unopened — past due INCLUDED (owner,
    // 2026-09-28: "focus should be the top priority no matter what").
    const scores = data.ranked.map((r) => r.score);
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    const eligible = data.ranked.filter((r) => (r.value ?? 0) > 0 && !r.locked && !r.passive).slice(0, data.recommendations.length);
    expect(data.recommendations.map((r) => r.canvasId)).toEqual(eligible.map((r) => r.canvasId));
  });

  it("gives every item the fields the views read", () => {
    for (const it of [...data.items, ...data.completed]) {
      expect(it.canvasId).toBeTypeOf("number");
      expect(it.name).toBeTruthy();
      expect(["assignment", "quiz", "exam", "other"]).toContain(it.type);
      expect(["normal", "overdue", "done"]).toContain(it.status);
    }
  });
});

// The demo must behave like a real account (audit 2026-09-28): everything derived
// the way lib/calendarData derives live data, not set by hand.
describe("buildDemoCalendarData derives like live data", () => {
  const { data, todayYmd } = buildDemoCalendarData(NOW);
  const all = [...data.items, ...data.completed];
  const byName = (n: string) => all.find((i) => i.name === n)!;

  it("one student zone and today, carried on the payload like CalendarData from the loader", () => {
    expect(data.timeZone).toBe(DEFAULT_STUDENT_ZONE);
    expect(data.todayYmd).toBe(todayYmd);
    expect(todayYmd).toBe(todayInZone(DEFAULT_STUDENT_ZONE, NOW));
    // "due today at 11 PM" is today in THAT zone, whatever zone the test runner is in
    expect(ymdInZone(byName("Reading Response").dueAt!, data.timeZone)).toBe(todayYmd);
    expect(new Intl.DateTimeFormat("en-US", { timeZone: data.timeZone, hour: "numeric", hour12: false }).format(new Date(byName("Reading Response").dueAt!))).toBe("23");
    expect(data.lastCheckedAt).toBeTruthy();
  });

  it("item type comes from submission type + name (lib/itemType), not a hand-set field", () => {
    expect(byName("Midterm Exam").type).toBe("exam");
    expect(byName("Midterm").type).toBe("exam");
    expect(byName("Quiz: Cell Division").type).toBe("quiz");
    expect(byName("Discussion Post").type).toBe("other");
    expect(byName("Essay Draft").type).toBe("assignment");
    const src = readFileSync("lib/demoData.ts", "utf8");
    expect(src).not.toMatch(/\btype: "(assignment|quiz|exam|other)"/);
    expect(src).toContain("itemType(r.submissionType, r.name)");
  });

  it("a participation grade is passive — ranked at importance 0, never Focus, never scheduled — exactly like live", () => {
    const p = byName("Participation");
    expect(p.passive).toBe(true);
    const r = data.ranked.find((x) => x.canvasId === p.canvasId)!;
    expect(r.passive).toBe(true);
    expect(r.value ?? 0).toBe(0);
    expect(data.recommendations.some((x) => x.canvasId === p.canvasId)).toBe(false);
    expect(data.plan.days.some((d) => d.blocks.some((b) => b.canvasId === p.canvasId))).toBe(false);
    // …so the English card can't say "Nothing upcoming" beside a count that includes it
    const english = data.items.filter((i) => i.courseName.startsWith("English"));
    expect(courseCounts(english, []).passive).toBe(1);
  });

  it("done/active is split by THE done rule (lib/assignmentStatus.assignmentDoneReason): scored by Canvas → graded", () => {
    for (const it of data.completed) expect(it.doneReason).toBe(it.score != null ? "graded" : "submitted");
    expect(data.items.every((i) => i.doneReason === undefined)).toBe(true);
    const src = readFileSync("lib/demoData.ts", "utf8");
    expect(src).toContain("assignmentDoneReason(row, { type: typeOf(r), dueAt: due, zone: timeZone, now })");
    expect(src).not.toMatch(/ROWS\.filter\(\(r\) => !?r\.done\)/);
  });
  it("passive items sit at the bottom of `ranked` with importance 0", () => {
    const passiveIdx = data.ranked.findIndex((r) => r.passive);
    expect(passiveIdx).toBeGreaterThanOrEqual(0);
    expect(data.ranked.slice(passiveIdx).every((r) => (r.value ?? 0) === 0)).toBe(true);
    expect(data.ranked[passiveIdx].reason).toBe("Graded by your teacher");
  });

  it("effort goes through lib/effort once: an AI estimate is padded 10%, no estimate → the default", () => {
    expect(byName("Problem Set 6").estimatedEffortHours).toBeCloseTo(2.2, 5); // 2h × 1.1
    expect(byName("Essay Draft").estimatedEffortHours).toBeCloseTo(3.3, 5);
    expect(byName("Vocabulary Quiz").estimatedEffortHours).toBe(1.5); // scheduled, no estimate → demo default
    const src = readFileSync("lib/demoData.ts", "utf8");
    expect(src).toContain("effectiveEffort(r)");
    expect(src).toContain("effortOrDefault(r, EFFORT_HOURS)");
    expect(src).not.toMatch(/estimatedEffortHours: r\.estimatedEffortHours/);
  });

  it("ranks with each course's grade (leverage), and the grade pills read the same totals", () => {
    const src = readFileSync("lib/demoData.ts", "utf8");
    expect(src).toContain("courseGrade: courseGrade(r)");
    const science = data.courses.find((c) => c.name.startsWith("Science"))!;
    const history = data.courses.find((c) => c.name.startsWith("History"))!;
    const english = data.courses.find((c) => c.name.startsWith("English"))!;
    expect(science.grade).toEqual({ state: "graded", score: 88, letter: "B+" });
    expect(history.grade.state).toBe("hidden");
    expect(english.grade.state).toBe("none");
  });
});
