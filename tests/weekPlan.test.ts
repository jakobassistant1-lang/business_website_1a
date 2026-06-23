import { describe, it, expect } from "vitest";
import { generateWeekPlan } from "@/lib/weekPlan";
import type { SchedulerAssignment } from "@/lib/scheduler";

const NOW = new Date(2026, 5, 1, 9, 0, 0); // Mon Jun 1 2026
const due = (offset: number, hour = 17) => new Date(2026, 5, 1 + offset, hour, 0, 0);

function mk(id: number, dueAt: Date | null, over: Partial<SchedulerAssignment> = {}): SchedulerAssignment {
  return { canvasId: id, name: `A${id}`, courseName: "C", dueAt, pointsPossible: 10, htmlUrl: null, ...over };
}
const study = (id: number, dueAt: Date, over: Partial<SchedulerAssignment> = {}) =>
  mk(id, dueAt, { assessmentTier: "exam", ...over });

const blocks = (p: ReturnType<typeof generateWeekPlan>) => p.days.flatMap((d, i) => d.blocks.map((b) => ({ ...b, day: i })));
const totalFor = (p: ReturnType<typeof generateWeekPlan>, id: number) =>
  blocks(p).filter((b) => b.canvasId === id).reduce((s, b) => s + b.hours, 0);

describe("generateWeekPlan — shared guarantees (parity with the old engine)", () => {
  it("schedules a deliverable's inflated effort as ≤1h chunks before its due date", () => {
    const p = generateWeekPlan([mk(1, due(3), { estimatedEffortHours: 2 })], 3, 7, 2, NOW);
    expect(totalFor(p, 1)).toBeCloseTo(2.4, 1); // 2h × 1.2 inflation
    blocks(p).forEach((b) => expect(b.hours).toBeLessThanOrEqual(1 + 1e-9));
    expect(blocks(p).length).toBeGreaterThan(1); // split, not one lump
    expect(p.overloadHours).toBe(0);
  });

  it("G1: every in-window-due item is represented, even at tight capacity", () => {
    const p = generateWeekPlan([mk(1, due(0)), mk(2, due(1)), mk(3, due(3)), mk(4, due(6))], 1, 7, 2, NOW);
    expect(p.inWindowDueCount).toBe(4);
    expect(p.representedCount).toBe(4);
    const ids = new Set(blocks(p).map((b) => b.canvasId));
    for (const id of [1, 2, 3, 4]) expect(ids.has(id)).toBe(true);
  });

  it("never allocates more than 90% of the daily budget", () => {
    const items = Array.from({ length: 12 }, (_, i) => mk(i + 1, due(2), { estimatedEffortHours: 1 }));
    const H = 4;
    const p = generateWeekPlan(items, H, 7, 2, NOW);
    for (const d of p.days) expect(d.allocated).toBeLessThanOrEqual(H * 0.9 + 1e-6);
  });

  it("never places a block after its due date", () => {
    const p = generateWeekPlan([mk(1, due(1), { estimatedEffortHours: 1 }), study(2, due(3), { estimatedEffortHours: 3 })], 3, 7, 2, NOW);
    for (const b of blocks(p)) {
      const dueIdx = Math.round((new Date(b.dueAt).setHours(0, 0, 0, 0) - new Date(NOW).setHours(0, 0, 0, 0)) / 86_400_000);
      expect(b.day).toBeLessThanOrEqual(dueIdx);
    }
  });

  it("puts undated items in the bucket, not the schedule", () => {
    const p = generateWeekPlan([mk(1, null)], 3, 7, 2, NOW);
    expect(p.undated.map((u) => u.canvasId)).toContain(1);
    expect(blocks(p)).toHaveLength(0);
  });

  it("flags overdue items as at-risk", () => {
    const p = generateWeekPlan([mk(1, due(-2))], 3, 7, 2, NOW);
    expect(p.atRisk.some((r) => r.canvasId === 1 && r.kind === "overdue")).toBe(true);
  });

  it("is deterministic", () => {
    const a = [mk(1, due(1), { estimatedEffortHours: 1 }), study(2, due(4), { estimatedEffortHours: 3, pointsPossible: 50 })];
    expect(generateWeekPlan(a, 3, 7, 2, NOW)).toEqual(generateWeekPlan(a, 3, 7, 2, NOW));
  });

  it("reports overload when the week can't fit everything", () => {
    const heavy = [1, 2, 3].map((i) => mk(i, due(1), { estimatedEffortHours: 10 }));
    expect(generateWeekPlan(heavy, 3, 7, 2, NOW).overloadHours).toBeGreaterThan(0);
  });
});

describe("generateWeekPlan — spaced study sessions (the new behavior)", () => {
  const p = generateWeekPlan([study(1, due(5), { estimatedEffortHours: 3 })], 4, 7, 2, NOW);
  const studyBlocks = blocks(p).filter((b) => b.canvasId === 1);

  it("produces multiple ≤1h study sessions, all flagged study + before the exam", () => {
    expect(studyBlocks.length).toBeGreaterThan(1);
    studyBlocks.forEach((b) => {
      expect(b.study).toBe(true);
      expect(b.hours).toBeLessThanOrEqual(1 + 1e-9);
      expect(b.day).toBeLessThan(5); // before the exam day
    });
  });

  it("the earliest session is a review, the rest are relearn", () => {
    const ordered = [...studyBlocks].sort((a, b) => a.day - b.day);
    expect(ordered[0].sessionKind).toBe("review");
    expect(ordered.slice(1).some((b) => b.sessionKind === "relearn")).toBe(true);
  });

  it("spreads sessions across multiple days (spacing)", () => {
    const distinctDays = new Set(studyBlocks.map((b) => b.day));
    expect(distinctDays.size).toBeGreaterThanOrEqual(3);
  });
});

describe("generateWeekPlan — contention (value wins scarce slots)", () => {
  it("a higher-value exam keeps more of its sessions when two collide on a tight budget", () => {
    const high = study(1, due(3), { estimatedEffortHours: 4, value: 100 });
    const low = study(2, due(3), { estimatedEffortHours: 4, value: 1 });
    const p = generateWeekPlan([high, low], 2, 7, 2, NOW); // 2h/day → 1.8h usable, tight
    expect(totalFor(p, 1)).toBeGreaterThanOrEqual(totalFor(p, 2));
    expect(p.overloadHours).toBeGreaterThan(0); // genuinely over capacity
  });
});
