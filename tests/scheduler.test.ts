import { describe, it, expect } from "vitest";
import { generatePlan, type SchedulerAssignment } from "@/lib/scheduler";

// Fixed "now" so the scheduler is deterministic: Mon Jun 1 2026, 09:00 local.
const NOW = new Date(2026, 5, 1, 9, 0, 0);

// A due date `offset` days from NOW (local), at 17:00.
function due(offset: number, hour = 17): Date {
  return new Date(2026, 5, 1 + offset, hour, 0, 0);
}

function mk(id: number, dueAt: Date | null, points: number | null = 10): SchedulerAssignment {
  return { canvasId: id, name: `A${id}`, courseName: "C", dueAt, pointsPossible: points, htmlUrl: null };
}

function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const totalFor = (plan: ReturnType<typeof generatePlan>, id: number) =>
  plan.days.flatMap((d) => d.blocks).filter((b) => b.canvasId === id).reduce((s, b) => s + b.hours, 0);
const dayFor = (plan: ReturnType<typeof generatePlan>, dayIdx: number, id: number) =>
  plan.days[dayIdx].blocks.filter((b) => b.canvasId === id).reduce((s, b) => s + b.hours, 0);

describe("generatePlan — core", () => {
  it("schedules a single assignment's full effort before its due date", () => {
    const plan = generatePlan([{ ...mk(1, due(2)), estimatedEffortHours: 2 }], 3, 7, 2, NOW);
    expect(totalFor(plan, 1)).toBeCloseTo(2, 5);
    expect(plan.overloadHours).toBe(0);
    expect(plan.atRisk).toHaveLength(0);
  });

  it("G1: every in-window due assignment is represented", () => {
    const assignments = [mk(1, due(0)), mk(2, due(1)), mk(3, due(3)), mk(4, due(6))];
    const plan = generatePlan(assignments, 1, 7, 2, NOW); // tight capacity
    expect(plan.inWindowDueCount).toBe(4);
    expect(plan.representedCount).toBe(plan.inWindowDueCount);
    const ids = new Set<number>();
    plan.days.forEach((d) => d.blocks.forEach((b) => ids.add(b.canvasId)));
    for (const id of [1, 2, 3, 4]) expect(ids.has(id)).toBe(true);
  });

  it("never allocates more than the daily budget on any day", () => {
    const assignments = Array.from({ length: 10 }, (_, i) => mk(i + 1, due(2)));
    const H = 4;
    const plan = generatePlan(assignments, H, 7, 2, NOW);
    for (const d of plan.days) expect(d.allocated).toBeLessThanOrEqual(H + 1e-9);
  });

  it("never schedules a block on a date after its due date", () => {
    const plan = generatePlan([mk(1, due(1)), mk(2, due(3))], 2, 7, 2, NOW);
    for (const d of plan.days) {
      for (const b of d.blocks) {
        expect(d.date <= ymdLocal(new Date(b.dueAt))).toBe(true);
      }
    }
  });

  it("puts no-due-date assignments in the undated bucket, not the schedule", () => {
    const plan = generatePlan([mk(1, null)], 3, 7, 2, NOW);
    expect(plan.undated.map((u) => u.canvasId)).toContain(1);
    expect(plan.days.flatMap((d) => d.blocks)).toHaveLength(0);
    expect(plan.inWindowDueCount).toBe(0);
  });

  it("flags overdue assignments as at-risk (kind=overdue)", () => {
    const plan = generatePlan([mk(1, due(-2))], 3, 7, 2, NOW);
    expect(plan.atRisk.some((r) => r.canvasId === 1 && r.kind === "overdue")).toBe(true);
  });

  it("is deterministic for identical inputs", () => {
    const a = [mk(1, due(1)), mk(2, due(1), 50), mk(3, due(2))];
    expect(generatePlan(a, 3, 7, 2, NOW)).toEqual(generatePlan(a, 3, 7, 2, NOW));
  });
});

describe("generatePlan — importance-weighted allocation", () => {
  it("front-loads the higher-importance (more points) assignment", () => {
    const essay = { ...mk(1, due(3), 200), estimatedEffortHours: 2 };
    const homework = { ...mk(2, due(3), 10), estimatedEffortHours: 2 };
    const plan = generatePlan([essay, homework], 3, 7, 2, NOW);
    // Day 0 favors the big essay…
    expect(dayFor(plan, 0, 1)).toBeGreaterThan(dayFor(plan, 0, 2));
    // …yet both still finish on time (deadline-safe), and the week isn't overloaded.
    expect(totalFor(plan, 1)).toBeCloseTo(2, 1);
    expect(totalFor(plan, 2)).toBeCloseTo(2, 1);
    expect(plan.overloadHours).toBe(0);
  });

  it("an AI importance rating boosts a low-point item's share", () => {
    // Same points, but item 1 is rated max importance → it should get more of day 0.
    const a = { ...mk(1, due(3), 20), estimatedEffortHours: 2, aiImportance: 5 };
    const b = { ...mk(2, due(3), 20), estimatedEffortHours: 2, aiImportance: 1 };
    const plan = generatePlan([a, b], 3, 7, 2, NOW);
    expect(dayFor(plan, 0, 1)).toBeGreaterThan(dayFor(plan, 0, 2));
  });

  it("reports overloadHours when the week can't fit everything, 0 when it can", () => {
    const heavy = [1, 2, 3].map((i) => ({ ...mk(i, due(1)), estimatedEffortHours: 10 }));
    expect(generatePlan(heavy, 3, 7, 2, NOW).overloadHours).toBeGreaterThan(0);
    const light = generatePlan([{ ...mk(1, due(5)), estimatedEffortHours: 3 }], 3, 7, 2, NOW);
    expect(light.overloadHours).toBe(0);
  });
});

describe("generatePlan — study sessions (exam/quiz lead window)", () => {
  it("only schedules study within `studyLeadDays` before the due day", () => {
    const exam = { ...mk(1, due(5)), estimatedEffortHours: 4, studyLeadDays: 2 };
    const plan = generatePlan([exam], 3, 7, 2, NOW);
    plan.days.forEach((d, idx) => {
      if (d.blocks.some((b) => b.study)) expect(idx).toBeGreaterThanOrEqual(3);
    });
    expect(plan.days.some((d) => d.blocks.some((b) => b.study))).toBe(true);
  });

  it("keeps a floor of study the day before, even when the rest front-loads", () => {
    const exam = { ...mk(1, due(4)), estimatedEffortHours: 2, studyLeadDays: 6 };
    const plan = generatePlan([exam], 5, 7, 2, NOW);
    expect(dayFor(plan, 3, 1)).toBeGreaterThan(0); // ~20 min reserved the day before (idx 3)
    expect(dayFor(plan, 0, 1)).toBeGreaterThan(dayFor(plan, 3, 1)); // bulk still earlier
  });

  it("flags study blocks with study=true and leaves regular work unflagged", () => {
    const exam = { ...mk(1, due(3)), estimatedEffortHours: 2, studyLeadDays: 5 };
    const hw = { ...mk(2, due(3)), estimatedEffortHours: 2 };
    const plan = generatePlan([exam, hw], 5, 7, 2, NOW);
    const examBlocks = plan.days.flatMap((d) => d.blocks).filter((b) => b.canvasId === 1);
    const hwBlocks = plan.days.flatMap((d) => d.blocks).filter((b) => b.canvasId === 2);
    expect(examBlocks.length).toBeGreaterThan(0);
    expect(examBlocks.every((b) => b.study === true)).toBe(true);
    expect(hwBlocks.every((b) => !b.study)).toBe(true);
  });
});

describe("generatePlan — per-assignment effort", () => {
  it("schedules an assignment for its AI-estimated hours, else the flat default", () => {
    const big = { ...mk(1, due(5)), estimatedEffortHours: 5 };
    const flat = mk(2, due(5)); // no estimate → uses E=2
    const plan = generatePlan([big, flat], 8, 7, 2, NOW);
    expect(totalFor(plan, 1)).toBeCloseTo(5, 5);
    expect(totalFor(plan, 2)).toBeCloseTo(2, 5);
    expect(plan.overloadHours).toBe(0);
  });

  it("surfaces a 0h marker for a zero-effort assignment (never dropped)", () => {
    const plan = generatePlan([{ ...mk(1, due(2)), estimatedEffortHours: 0 }], 3, 7, 2, NOW);
    const blocks = plan.days.flatMap((d) => d.blocks).filter((b) => b.canvasId === 1);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.every((b) => b.hours === 0)).toBe(true);
  });
});
