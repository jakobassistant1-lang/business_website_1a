// "EVERYTHING SHOULD AGREE EVERYWHERE" (Calvin, 2026-09-28) — the engine half.
//  #143  a due-day marker is never a study session (no "Study booked · 0m" on test day)
//  #136  one effort number: padded once, blocks sum to the tag, one "no estimate" rule
//  zone  days are the student's (Canvas profile zone), never the server's
// Behaviour tests: they run the real scheduler and read what it hands the screens.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/access", () => ({ requireActiveUser: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { update: vi.fn() } } }));

import { requireActiveUser } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { PATCH as settingsPATCH } from "@/app/api/settings/route";
import { generateWeekPlan } from "@/lib/weekPlan";
import { generatePlan } from "@/lib/scheduler";
import { itemType } from "@/lib/itemType";
import { assessmentTier, MAX_BLOCK } from "@/lib/studyPlan";
import { isStudySessionBlock } from "@/lib/studyWeek";
import { effortOrDefault, MIN_BLOCK } from "@/lib/effort";
import { fmtHours, effortHoursText } from "@/lib/effortFormat";
import { overdueLoad } from "@/lib/intensity";
import type { DayBlock, Plan, SchedulerAssignment } from "@/lib/scheduler";

const NY = "America/New_York";
// Mon Sep 28 2026, noon in New York.
const NOW = new Date("2026-09-28T16:00:00Z");
/** 11:59 PM New York time, `offset` days after Mon Sep 28 (EDT = UTC−4). */
const dueNY = (offset: number) => new Date(Date.UTC(2026, 8, 28 + offset + 1, 3, 59));

function mk(id: number, dueAt: Date | null, over: Partial<SchedulerAssignment> = {}): SchedulerAssignment {
  return { canvasId: id, name: `Item ${id}`, courseName: "Course", dueAt, pointsPossible: 10, htmlUrl: null, value: 10, ...over };
}
const quiz = (id: number, dueAt: Date, over: Partial<SchedulerAssignment> = {}) =>
  mk(id, dueAt, { assessmentTier: "quiz", studyLeadDays: 3, name: `Quiz ${id}`, ...over });
const exam = (id: number, dueAt: Date, over: Partial<SchedulerAssignment> = {}) =>
  mk(id, dueAt, { assessmentTier: "exam", studyLeadDays: 7, name: `Exam ${id}`, ...over });

const plan = (items: SchedulerAssignment[], hoursPerDay = 3, zone = NY, now = NOW) =>
  generateWeekPlan(items, hoursPerDay, 7, 2, now, zone);
const allBlocks = (p: Plan) => p.days.flatMap((d, day) => d.blocks.map((b) => ({ ...b, day, date: d.date })));
const blocksOf = (p: Plan, id: number) => allBlocks(p).filter((b) => b.canvasId === id);
const sumHours = (bs: { hours: number }[]) => bs.reduce((s, b) => s + b.hours, 0);
const TODAY = "2026-09-28";

/** THE accounting invariant: for every in-window item, placed + unplaced + expired
 *  = its effort. Expired = study for a test that is today (it can't happen anymore). */
function expectEffortAccounted(p: Plan, items: SchedulerAssignment[], zoneToday = TODAY) {
  const inWindow = new Set(p.days.map((d) => d.date));
  for (const a of items) {
    if (!a.dueAt) continue;
    const dueDay = new Intl.DateTimeFormat("en-CA", { timeZone: NY }).format(a.dueAt);
    if (!inWindow.has(dueDay)) continue; // past due or a later week
    const effort = a.estimatedEffortHours ?? 2;
    const placed = sumHours(blocksOf(p, a.canvasId));
    const unplaced = p.shortfalls.find((x) => x.canvasId === a.canvasId)?.hours ?? 0;
    const expired = a.assessmentTier != null && dueDay === zoneToday ? effort : 0;
    expect(placed + unplaced + expired).toBeCloseTo(effort, 6);
    if (expired > 0) expect(placed + unplaced).toBe(0);
  }
  // The week total is exactly the per-item shortfalls.
  expect(p.overloadHours).toBeCloseTo(sumHours(p.shortfalls), 6);
  // No block breaks the ≤1h session cap.
  for (const b of allBlocks(p)) expect(b.hours).toBeLessThanOrEqual(MAX_BLOCK + 1e-9);
}

/** The invariant every scenario must hold (#143). */
function expectOneStudyRule(p: Plan) {
  for (const b of allBlocks(p)) {
    expect(b.study && b.hours <= 0).toBe(false); // never a 0h "study" block
    if (b.marker) {
      expect(b.study).toBe(false);
      expect(b.hours).toBe(0);
    }
    // THE rule agrees with the flags: a study session is exactly a placed (>0h) study block.
    expect(isStudySessionBlock(b, TODAY, NY)).toBe(!!b.study && !b.marker && b.hours > 0);
  }
}

describe("#143 — study sessions, one rule (five scheduler scenarios)", () => {
  it("(A) calm week, quiz due TODAY → one due-day marker, not a study session", () => {
    const p = plan([quiz(1, dueNY(0), { estimatedEffortHours: 1.1 })]);
    const bs = blocksOf(p, 1);
    expect(bs).toHaveLength(1);
    expect(bs[0]).toMatchObject({ day: 0, date: TODAY, hours: 0, marker: true, study: false });
    expect(isStudySessionBlock(bs[0], TODAY, NY)).toBe(false);
    expect(p.atRisk).toHaveLength(0); // due tonight is not past due
    expectOneStudyRule(p);
  });

  it("(B) quiz in 3 days → real study sessions only, all before the quiz", () => {
    const p = plan([quiz(1, dueNY(3), { estimatedEffortHours: 1.65 })]);
    const bs = blocksOf(p, 1);
    expect(bs.length).toBeGreaterThan(1);
    for (const b of bs) {
      expect(b.marker).toBeUndefined();
      expect(b.study).toBe(true);
      expect(b.hours).toBeGreaterThan(0);
      expect(b.day).toBeLessThan(3);
      expect(isStudySessionBlock(b, TODAY, NY)).toBe(true);
    }
    expect(sumHours(bs)).toBeCloseTo(1.65, 9);
    expectOneStudyRule(p);
  });

  it("(C) a 0.5h/day budget → sessions that don't fit become overload, never 0h study", () => {
    const p = plan(
      [quiz(1, dueNY(2), { estimatedEffortHours: 2 }), exam(2, dueNY(4), { estimatedEffortHours: 3 }), mk(3, dueNY(1), { estimatedEffortHours: 1 })],
      0.5,
    );
    expect(p.overloadHours).toBeGreaterThan(0);
    expect(p.representedCount).toBe(p.inWindowDueCount);
    expectOneStudyRule(p);
    expectEffortAccounted(p, [quiz(1, dueNY(2), { estimatedEffortHours: 2 }), exam(2, dueNY(4), { estimatedEffortHours: 3 }), mk(3, dueNY(1), { estimatedEffortHours: 1 })]);
  });

  it("(D) AI estimate 0 → a marker on the due day, no study session", () => {
    const p = plan([quiz(1, dueNY(2), { estimatedEffortHours: 0 })]);
    const bs = blocksOf(p, 1);
    expect(bs).toHaveLength(1);
    expect(bs[0]).toMatchObject({ day: 2, hours: 0, marker: true, study: false });
    expectOneStudyRule(p);
  });

  it("(E) a packed week → overload surfaces, every item represented, the rule holds", () => {
    const items: SchedulerAssignment[] = [];
    for (let i = 0; i < 4; i++) items.push(exam(10 + i, dueNY(1 + i), { estimatedEffortHours: 4, value: 50 - i }));
    for (let i = 0; i < 4; i++) items.push(quiz(20 + i, dueNY(i), { estimatedEffortHours: 1.5, value: 30 - i }));
    for (let i = 0; i < 8; i++) items.push(mk(30 + i, dueNY(i % 7), { estimatedEffortHours: 3, value: 20 - i }));
    const p = plan(items, 2);
    expect(p.overloadHours).toBeGreaterThan(0);
    expect(p.representedCount).toBe(p.inWindowDueCount);
    expect(allBlocks(p).some((b) => b.marker)).toBe(true); // squeezed-out items still show on their due day
    expectOneStudyRule(p);
    expectEffortAccounted(p, items);
    expect(p.shortfalls.length).toBeGreaterThan(0);
  });
});

describe("accounting — placed + unplaced + expired = effort, for every item", () => {
  it("a test due TODAY: its study has expired — not placed, not overload (no false exam-day overload)", () => {
    const items = [exam(1, dueNY(0), { estimatedEffortHours: 4.4 }), mk(2, dueNY(0), { estimatedEffortHours: 1 })];
    const p = plan(items);
    expect(sumHours(blocksOf(p, 1))).toBe(0);
    expect(p.shortfalls).toEqual([]);
    expect(p.overloadHours).toBe(0);
    expect(sumHours(blocksOf(p, 2))).toBeCloseTo(1, 9); // same-day homework still gets its hour
    expectEffortAccounted(p, items);
  });

  it("a mid-week load that fits: everything placed, no shortfall", () => {
    const items = [exam(1, dueNY(3), { estimatedEffortHours: 4.4 }), quiz(2, dueNY(2), { estimatedEffortHours: 1.65 }), mk(3, dueNY(4), { estimatedEffortHours: 2.2 })];
    const p = plan(items, 4);
    expect(p.shortfalls).toEqual([]);
    expect(p.overloadHours).toBe(0);
    expectEffortAccounted(p, items);
  });

  it("an overloaded week: what didn't fit is per item in `shortfalls`, summing to overloadHours", () => {
    const items = [exam(1, dueNY(2), { estimatedEffortHours: 6, value: 90 }), mk(2, dueNY(2), { estimatedEffortHours: 4, value: 10 }), mk(3, dueNY(1), { estimatedEffortHours: 3, value: 5 })];
    const p = plan(items, 2);
    expect(p.shortfalls.length).toBeGreaterThan(0);
    expect(p.overloadHours).toBeGreaterThan(0);
    expectEffortAccounted(p, items);
  });

  it("blocks for the same item on the same day are never merged past 1h", () => {
    // 4 sessions squeezed into a 2-day window (two a day) + a 4.95h paper due tomorrow.
    const items = [exam(1, dueNY(2), { estimatedEffortHours: 3.8, studyLeadDays: 2 }), mk(2, dueNY(1), { estimatedEffortHours: 4.95 })];
    const p = plan(items, 12);
    const perDay = (id: number) => new Map(blocksOf(p, id).map((b) => [b.day, blocksOf(p, id).filter((x) => x.day === b.day).length]));
    expect([...perDay(1).values()].some((n) => n > 1)).toBe(true); // two separate sessions on one day, not one 2h lump
    expectEffortAccounted(p, items);
  });

  it("the legacy planner (/api/plan, /api/briefing) rounds to hundredths, like the tag", () => {
    const p = generatePlan([mk(1, dueNY(0), { estimatedEffortHours: 0.28 })], 3, 7, 2, NOW, NY);
    const b = blocksOf(p, 1);
    expect(sumHours(b)).toBe(0.28);
    expect(fmtHours(sumHours(b))).toBe(effortHoursText(0.28)!.slice(1)); // "15m" both — not "20m" vs "~15m"
  });
});

describe("#136 — one effort number: what the plan budgets is what the tag shows", () => {
  it("a 4.5h AI estimate → 4.95h planned → blocks sum 4.95 → the tag and the block total print the same", () => {
    const hours = effortOrDefault({ estimatedEffortHours: 4.5, effortOverrideHours: null }, 2);
    expect(hours).toBe(4.95);
    // A deliverable…
    const work = blocksOf(plan([mk(1, dueNY(5), { estimatedEffortHours: hours })], 4), 1);
    expect(sumHours(work)).toBeCloseTo(4.95, 9);
    expect(fmtHours(sumHours(work))).toBe(fmtHours(hours));
    expect(effortHoursText(hours)).toBe(`~${fmtHours(sumHours(work))}`);
    // …and an exam's study sessions (lead 6 days → every session lands in the week).
    const study = blocksOf(plan([exam(2, dueNY(6), { estimatedEffortHours: hours, studyLeadDays: 6 })], 4), 2);
    expect(study.every((b) => b.study)).toBe(true);
    expect(sumHours(study)).toBeCloseTo(4.95, 9);
    expect(fmtHours(sumHours(study))).toBe(fmtHours(hours));
  });

  it("a 2h number the student typed → 2h everywhere (never padded)", () => {
    const hours = effortOrDefault({ estimatedEffortHours: 4.5, effortOverrideHours: 2 }, 2);
    expect(hours).toBe(2);
    const bs = blocksOf(plan([mk(1, dueNY(4), { estimatedEffortHours: hours })]), 1);
    expect(sumHours(bs)).toBeCloseTo(2, 9);
    expect(fmtHours(sumHours(bs))).toBe("2h");
    expect(effortHoursText(hours)).toBe("~2h");
  });

  it("no estimate yet → the same default in the scheduler, the past-due list and the week intensity", () => {
    const hours = effortOrDefault({ estimatedEffortHours: null, effortOverrideHours: null }, 2);
    expect(hours).toBe(2);
    const bs = blocksOf(plan([mk(1, dueNY(4), { estimatedEffortHours: hours })]), 1);
    expect(sumHours(bs)).toBeCloseTo(2, 9);
    // Past due: the scheduler's shortfall and the intensity's hours are the same number.
    const late = plan([mk(2, dueNY(-3), { estimatedEffortHours: hours })]);
    expect(late.atRisk[0].shortfallHours).toBe(2);
    expect(overdueLoad([{ status: "overdue", estimatedEffortHours: hours }], 2).overdueHours).toBe(2);
  });
});

describe("#136 — below MIN_BLOCK (3 min): no block AND no tag, never \"0m\"", () => {
  it("0.01–0.04h prints nothing and schedules nothing", () => {
    for (const h of [0.01, 0.02, 0.04]) {
      expect(effortHoursText(h)).toBeNull();
      expect(fmtHours(h)).toBe("");
      expect(sumHours(blocksOf(plan([mk(1, dueNY(3), { estimatedEffortHours: h })]), 1))).toBe(0);
    }
    expect(effortHoursText(MIN_BLOCK)).toBe("~5m");
    expect(sumHours(blocksOf(plan([mk(1, dueNY(3), { estimatedEffortHours: MIN_BLOCK })]), 1))).toBe(MIN_BLOCK);
  });
});

describe("exam-by-name — one rule (lib/itemType)", () => {
  const exams = ["Cumulative Final", "Final", "Final Exam", "Midterm 2", "Unit 4 Test", "Cumulative final (in class)", "FINAL"];
  const assignments = ["Final Paper", "Final Project Proposal", "Final Reflection", "Final Draft", "Final Essay", "Final Lab Report", "Final Presentation", "Final Portfolio", "Cumulative Portfolio Submission"];
  for (const name of exams) it(`"${name}" is an exam`, () => expect(itemType(null, name)).toBe("exam"));
  for (const name of assignments) it(`"${name}" stays an assignment`, () => expect(itemType("online_upload", name)).toBe("assignment"));
  it("a name that says quiz / discussion keeps that type", () => {
    expect(itemType(null, "Final Quiz")).toBe("quiz");
    expect(itemType(null, "Final Discussion Post")).toBe("other");
  });
  it("finals and cumulative exams get the long (studyDaysFinal) tier", () => {
    expect(assessmentTier("exam", "Cumulative Final")).toBe("final");
    expect(assessmentTier("exam", "Final")).toBe("final");
  });
});

describe("settings — studyDaysFinal is settable and validated like the other two", () => {
  const patch = (body: unknown) => settingsPATCH(new Request("http://x/api/settings", { method: "PATCH", body: JSON.stringify(body) }));
  beforeEach(() => {
    vi.mocked(requireActiveUser).mockResolvedValue({ id: 7 } as never);
    vi.mocked(prisma.user.update).mockReset();
  });
  it("saves a whole number of days 1–28 (midterms/finals default to 14)", async () => {
    const res = await patch({ studyDaysFinal: 10 });
    expect(res.status).toBe(200);
    expect(vi.mocked(prisma.user.update)).toHaveBeenCalledWith({ where: { id: 7 }, data: { studyDaysFinal: 10 } });
  });
  it("rejects 0, 29 and fractions", async () => {
    for (const v of [0, 29, 2.5, "x"]) {
      const res = await patch({ studyDaysFinal: v });
      expect(res.status).toBe(400);
      expect((await res.json()).errors.studyDaysFinal).toBeTruthy();
    }
    expect(vi.mocked(prisma.user.update)).not.toHaveBeenCalled();
  });
});

describe("zone — days are the student's, never the server's", () => {
  // A Wednesday 11:59 PM New York deadline is 03:59 Thursday in UTC.
  const DUE = new Date("2026-10-01T03:59:00Z");
  const markerDay = (zone: string) => {
    const p = plan([mk(1, DUE, { estimatedEffortHours: 0 })], 3, zone);
    const d = p.days.find((day) => day.blocks.some((b) => b.canvasId === 1))!;
    return { date: d.date, weekday: d.weekday };
  };

  it("2026-10-01T03:59Z lands on Wed Sep 30 in America/New_York, on Thu Oct 1 in UTC", () => {
    expect(markerDay(NY)).toEqual({ date: "2026-09-30", weekday: "Wed" });
    expect(markerDay("UTC")).toEqual({ date: "2026-10-01", weekday: "Thu" });
  });

  it("day 0 / isToday is today in the student's zone (10 PM Mon in New York is already Tue in UTC)", () => {
    const lateMon = new Date("2026-09-29T02:00:00Z");
    const ny = plan([], 3, NY, lateMon);
    const utc = plan([], 3, "UTC", lateMon);
    expect(ny.days[0]).toMatchObject({ date: "2026-09-28", weekday: "Mon", isToday: true });
    expect(ny.windowStart).toBe("2026-09-28");
    expect(ny.windowEnd).toBe("2026-10-04");
    expect(utc.days[0]).toMatchObject({ date: "2026-09-29", weekday: "Tue", isToday: true });
  });

  it("past due only once the due DAY has passed in the student's zone", () => {
    const monNight = new Date("2026-09-29T03:59:00Z"); // Mon 11:59 PM New York
    const morningDue = new Date("2026-09-28T13:00:00Z"); // Mon 9 AM New York
    const at = (now: string, due: Date) => plan([mk(1, due, { estimatedEffortHours: 1 })], 3, NY, new Date(now));
    expect(at("2026-09-29T03:00:00Z", monNight).atRisk).toHaveLength(0); // Mon 11 PM: due tonight → not past due
    expect(at("2026-09-29T03:00:00Z", morningDue).atRisk).toHaveLength(0); // same day, hour passed → still today
    expect(at("2026-09-29T05:00:00Z", monNight).atRisk.map((r) => r.kind)).toEqual(["overdue"]); // Tue 1 AM → past due
  });

  it("isStudySessionBlock reads the assessment's due day in the given zone", () => {
    const b: Pick<DayBlock, "study" | "hours" | "dueAt" | "marker"> = { study: true, hours: 0.5, dueAt: "2026-10-01T03:59:00Z" };
    expect(isStudySessionBlock(b, "2026-10-01", NY)).toBe(false); // due Wed in NY → past on Thu
    expect(isStudySessionBlock(b, "2026-10-01", "UTC")).toBe(true);
    expect(isStudySessionBlock({ ...b, marker: true }, "2026-09-28", NY)).toBe(false); // a marker never counts
  });

  it("a DST week (clocks fall back Sun Nov 1 2026 in New York): seven distinct days, deadlines on the right one", () => {
    const now = new Date("2026-10-29T16:00:00Z"); // Thu Oct 29, noon EDT
    const satNight = new Date("2026-11-01T03:59:00Z"); // Sat Oct 31, 11:59 PM EDT
    const monNight = new Date("2026-11-03T04:59:00Z"); // Mon Nov 2, 11:59 PM EST
    const items = [mk(1, satNight, { estimatedEffortHours: 0 }), mk(2, monNight, { estimatedEffortHours: 0 }), mk(3, monNight, { estimatedEffortHours: 3.3 })];
    const p = plan(items, 3, NY, now);
    expect(p.days.map((d) => `${d.weekday} ${d.date}`)).toEqual([
      "Thu 2026-10-29", "Fri 2026-10-30", "Sat 2026-10-31", "Sun 2026-11-01", "Mon 2026-11-02", "Tue 2026-11-03", "Wed 2026-11-04",
    ]);
    expect(p.days.find((d) => d.blocks.some((b) => b.canvasId === 1))!.date).toBe("2026-10-31");
    expect(p.days.find((d) => d.blocks.some((b) => b.canvasId === 2))!.date).toBe("2026-11-02");
    expect(blocksOf(p, 3).every((b) => b.day <= 4)).toBe(true); // never after Monday
    expectEffortAccounted(p, items, "2026-10-29");
  });
});
