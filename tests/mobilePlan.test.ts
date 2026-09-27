// Plan on phones (#39 follow-up): separated agenda rows, a violet #1 row, and the
// "Study this week" strip. The chip builder is pure and table-tested; the rest are
// source guards (like tests/mobileToday) so the layout can't quietly regress.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { studyChipsFromPlan, STUDY_WEEK_DAYS } from "@/lib/studyWeek";
import type { DayBlock, PlanDay } from "@/lib/scheduler";

const read = (p: string) => readFileSync(p, "utf8");

// Local-time fixtures: "now" is Wed 2026-09-23, 10:00 local.
const NOW = new Date(2026, 8, 23, 10, 0, 0);
const iso = (y: number, m: number, d: number, h = 23) => new Date(y, m - 1, d, h, 59).toISOString();

function block(p: Partial<DayBlock> & Pick<DayBlock, "canvasId" | "name">): DayBlock {
  return { courseName: "2025F-10: Biology", hours: 0.75, htmlUrl: null, dueAt: iso(2026, 9, 30), study: true, ...p };
}
const day = (date: string, blocks: DayBlock[]): Pick<PlanDay, "date" | "blocks"> => ({ date, blocks });

describe("studyChipsFromPlan", () => {
  it("empty plan / no study blocks → no chips", () => {
    expect(studyChipsFromPlan([], NOW)).toEqual([]);
    expect(studyChipsFromPlan([day("2026-09-23", [])], NOW)).toEqual([]);
    expect(studyChipsFromPlan([day("2026-09-23", [block({ canvasId: 1, name: "Lab report", study: false })])], NOW)).toEqual([]);
  });

  it("two sessions across two days", () => {
    const chips = studyChipsFromPlan(
      [
        day("2026-09-24", [block({ canvasId: 11, name: "Quiz 3", hours: 0.75 })]),
        day("2026-09-28", [block({ canvasId: 12, name: "Midterm", hours: 1 })]),
      ],
      NOW,
    );
    expect(chips).toEqual([
      { dayLabel: "Thu", title: "Quiz 3", hours: 0.75, canvasId: 11, date: "2026-09-24" },
      { dayLabel: "Mon", title: "Midterm", hours: 1, canvasId: 12, date: "2026-09-28" },
    ]);
  });

  it("sorted by date whatever the input order; plan order kept within a day", () => {
    const chips = studyChipsFromPlan(
      [
        day("2026-09-27", [block({ canvasId: 3, name: "C" })]),
        day("2026-09-23", [block({ canvasId: 1, name: "A" }), block({ canvasId: 2, name: "B" })]),
        day("2026-09-25", [block({ canvasId: 4, name: "D" })]),
      ],
      NOW,
    );
    expect(chips.map((c) => c.canvasId)).toEqual([1, 2, 4, 3]);
    expect(chips.map((c) => c.dayLabel)).toEqual(["Today", "Today", "Fri", "Sun"]); // today reads "Today", not its weekday
  });

  it("only the next 7 days (today through today+6), only real upcoming study", () => {
    const chips = studyChipsFromPlan(
      [
        day("2026-09-22", [block({ canvasId: 1, name: "yesterday" })]),
        day("2026-09-23", [block({ canvasId: 2, name: "today" })]),
        day("2026-09-29", [block({ canvasId: 3, name: "day 7", dueAt: iso(2026, 10, 2) })]),
        day("2026-09-30", [block({ canvasId: 4, name: "day 8", dueAt: iso(2026, 10, 2) })]),
        day("2026-09-24", [
          block({ canvasId: 5, name: "zero hours", hours: 0 }),
          block({ canvasId: 6, name: "past assessment", dueAt: iso(2026, 9, 20) }),
        ]),
      ],
      NOW,
    );
    expect(STUDY_WEEK_DAYS).toBe(7);
    expect(chips.map((c) => c.title)).toEqual(["today", "day 7"]);
  });

  it("session length is formatted by fmtHours — the one effort formatter — never a local copy", () => {
    expect(read("components/StudyWeekStrip.tsx")).toContain("fmtHours(c.hours)");
    expect(read("lib/studyWeek.ts")).not.toMatch(/minutesLabel|blockMinutes/);
  });

  it("Plan and Dashboard share ONE local-day correction (useLocalToday), so their study lists agree on today", () => {
    expect(read("components/PlanSurface.tsx")).toContain("useLocalToday(serverToday)");
    expect(read("components/DashboardView.tsx")).toContain("useLocalToday(serverToday)");
  });
});

describe("PlanSurface — separated rows, violet #1 on phones, study strip on top", () => {
  const src = read("components/PlanSurface.tsx");

  it("renders the StudyWeekStrip above the views (under the header)", () => {
    const strip = src.indexOf("<StudyWeekStrip");
    expect(strip).toBeGreaterThan(src.indexOf('data-tour="plan-views"'));
    expect(strip).toBeLessThan(src.indexOf("{shown === null &&"));
    expect(strip).toBeLessThan(src.indexOf('{shown === "list" &&'));
  });

  it("list rows are separate cards with a gap between", () => {
    const list = src.slice(src.indexOf("function PlanList("), src.indexOf("function PlanRow("));
    const container = list.slice(0, list.indexOf("<PlanRow")).match(/className="([^"]*)"[^<]*$/)?.[1] ?? "";
    expect(container.split(/\s+/).some((t) => t === "space-y-2" || t === "gap-2")).toBe(true);
    expect(container).not.toContain("divide-y");
    const row = src.slice(src.indexOf("function PlanRow("));
    expect(row.match(/<Link[\s\S]*?className=\{`([^`]*)`\}/)?.[1].split(/\s+/)).toEqual(expect.arrayContaining(["card", "tap", "flex"]));
  });

  it("the phone's first row carries the Focus card's violet classes", () => {
    expect(src).toContain("focus={isPhone && i === 0}");
    const row = src.slice(src.indexOf("function PlanRow("));
    expect(row).toContain('focus ? "border-accent bg-accent text-white"');
    expect(src).toContain('const FOCUS_CHIP = "bg-white/15 text-white ring-1 ring-inset ring-white/25"');
  });
});

describe("the study-block rule has one home (lib/studyWeek)", () => {
  const parts = read("components/calendar/parts.tsx");
  it("parts.tsx imports isStudySessionBlock from @/lib/studyWeek and delegates to it", () => {
    expect(parts).toMatch(/import \{[^}]*\bisStudySessionBlock\b[^}]*\} from "@\/lib\/studyWeek";/);
    const fn = parts.slice(parts.indexOf("export function isUpcomingStudy("));
    expect(fn.slice(0, fn.indexOf("\n}\n"))).toContain("isStudySessionBlock(b, todayYmd)");
  });
  it("parts.tsx keeps no second inline copy of the rule", () => {
    expect(parts).not.toMatch(/b\.hours > 0/);
    expect(parts).not.toMatch(/ymd\(new Date\(b\.dueAt\)\)/);
  });
});

describe("StudyWeekStrip", () => {
  const src = read("components/StudyWeekStrip.tsx");
  it("chips link to /study/<canvasId>, snap-scroll sideways, 44px on phones, violet-soft", () => {
    expect(src).toContain("href={`/study/${c.canvasId}`}");
    expect(src).toContain("snap-x");
    expect(src).toContain("overflow-x-auto");
    const link = src.slice(src.indexOf("<Link")).match(/className="([^"]*)"/)?.[1].split(/\s+/) ?? [];
    expect(link).toEqual(expect.arrayContaining(["max-md:tap", "bg-accent-soft", "text-accent"]));
  });
  it("renders nothing without sessions, and is headed 'Study this week'", () => {
    expect(src).toContain("if (chips.length === 0) return null;");
    expect(src).toContain("Study this week");
    expect(src).toContain("studyChipsFromPlan(");
  });
});
