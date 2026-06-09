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

describe("generatePlan", () => {
  it("schedules an assignment that fits before its due date", () => {
    const plan = generatePlan([mk(1, due(2))], 3, 7, 2, NOW);
    const blocks = plan.days.flatMap((d) => d.blocks).filter((b) => b.canvasId === 1);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.reduce((s, b) => s + b.hours, 0)).toBeCloseTo(2, 5);
    expect(plan.atRisk).toHaveLength(0);
  });

  it("G1: every in-window due assignment is represented (scheduled and/or at-risk)", () => {
    const assignments = [mk(1, due(0)), mk(2, due(1)), mk(3, due(3)), mk(4, due(6))];
    const plan = generatePlan(assignments, 1, 7, 2, NOW); // tight capacity → some at-risk
    expect(plan.inWindowDueCount).toBe(4);
    expect(plan.representedCount).toBe(plan.inWindowDueCount);
    const ids = new Set<number>();
    plan.days.forEach((d) => d.blocks.forEach((b) => ids.add(b.canvasId)));
    plan.atRisk.forEach((r) => ids.add(r.canvasId));
    for (const id of [1, 2, 3, 4]) expect(ids.has(id)).toBe(true);
  });

  it("never allocates more than H hours on any day", () => {
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

  it("flags work that can't fit before its deadline as at-risk (insufficient_time)", () => {
    const plan = generatePlan([mk(1, due(1))], 1, 7, 10, NOW); // needs 10h, ~2h available
    const r = plan.atRisk.find((x) => x.canvasId === 1);
    expect(r?.kind).toBe("insufficient_time");
    expect(r?.shortfallHours).toBeGreaterThan(0);
  });

  it("is deterministic for identical inputs", () => {
    const a = [mk(1, due(1)), mk(2, due(1), 50), mk(3, due(2))];
    expect(generatePlan(a, 3, 7, 2, NOW)).toEqual(generatePlan(a, 3, 7, 2, NOW));
  });
});

describe("generatePlan — calendar busy-time", () => {
  it("subtracts busy hours from a day's capacity", () => {
    const busy = new Map([[ymdLocal(NOW), 2]]); // 2 busy hours today
    const plan = generatePlan([mk(1, due(3))], 3, 7, 2, NOW, busy);
    expect(plan.days[0].capacity).toBeCloseTo(1, 5); // 3 - 2
    expect(plan.days[1].capacity).toBeCloseTo(3, 5); // unaffected
  });

  it("never drives capacity below zero even if busy exceeds the daily budget", () => {
    const busy = new Map([[ymdLocal(NOW), 10]]); // more busy than the 3h budget
    const plan = generatePlan([mk(1, due(3))], 3, 7, 2, NOW, busy);
    expect(plan.days[0].capacity).toBe(0);
  });

  it("flags work as at-risk when busy-time leaves no room before the due date", () => {
    // Due tomorrow, needs 4h, but today and tomorrow are both fully booked.
    const busy = new Map([
      [ymdLocal(NOW), 3],
      [ymdLocal(due(1)), 3],
    ]);
    const plan = generatePlan([{ ...mk(1, due(1)), estimatedEffortHours: 4 }], 3, 7, 2, NOW, busy);
    expect(plan.atRisk.some((r) => r.canvasId === 1 && r.kind === "insufficient_time")).toBe(true);
  });

  it("ignores busy-time with no connected calendar (empty map) — unchanged behavior", () => {
    const withMap = generatePlan([mk(1, due(2))], 3, 7, 2, NOW, new Map());
    const without = generatePlan([mk(1, due(2))], 3, 7, 2, NOW);
    expect(withMap).toEqual(without);
  });
});

describe("generatePlan — study sessions (exam/quiz lead window)", () => {
  it("only schedules study within `studyLeadDays` before the due day", () => {
    // Exam due in 5 days (idx 5), 4h effort, 2-day lead → study only on idx >= 3.
    const exam = { ...mk(1, due(5)), estimatedEffortHours: 4, studyLeadDays: 2 };
    const plan = generatePlan([exam], 3, 7, 2, NOW);
    plan.days.forEach((d, idx) => {
      if (d.blocks.some((b) => b.study)) expect(idx).toBeGreaterThanOrEqual(3);
    });
    expect(plan.days.some((d) => d.blocks.some((b) => b.study))).toBe(true);
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
  const sumFor = (plan: ReturnType<typeof generatePlan>, id: number) =>
    plan.days.flatMap((d) => d.blocks).filter((b) => b.canvasId === id).reduce((s, b) => s + b.hours, 0);

  it("schedules an assignment for its AI-estimated hours, else the flat default", () => {
    const big = { ...mk(1, due(5)), estimatedEffortHours: 5 };
    const flat = mk(2, due(5)); // no estimate → uses E=2
    const plan = generatePlan([big, flat], 8, 7, 2, NOW);
    expect(sumFor(plan, 1)).toBeCloseTo(5, 5);
    expect(sumFor(plan, 2)).toBeCloseTo(2, 5);
    expect(plan.atRisk).toHaveLength(0);
  });

  it("keeps the G1 guarantee with mixed efforts (0 / default / huge) under tight capacity", () => {
    const items = [
      { ...mk(1, due(1)), estimatedEffortHours: 0 },
      mk(2, due(2)),
      { ...mk(3, due(2)), estimatedEffortHours: 50 },
    ];
    const plan = generatePlan(items, 1, 7, 2, NOW);
    expect(plan.representedCount).toBe(plan.inWindowDueCount);
    const ids = new Set<number>();
    plan.days.forEach((d) => d.blocks.forEach((b) => ids.add(b.canvasId)));
    plan.atRisk.forEach((r) => ids.add(r.canvasId));
    for (const id of [1, 2, 3]) expect(ids.has(id)).toBe(true);
  });

  it("surfaces a 0h marker for a zero-effort assignment (never dropped)", () => {
    const plan = generatePlan([{ ...mk(1, due(2)), estimatedEffortHours: 0 }], 3, 7, 2, NOW);
    const blocks = plan.days.flatMap((d) => d.blocks).filter((b) => b.canvasId === 1);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.every((b) => b.hours === 0)).toBe(true);
  });
});
