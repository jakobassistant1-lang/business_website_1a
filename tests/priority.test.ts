import { describe, it, expect } from "vitest";
import {
  scoreAssignments,
  rankRecommendations,
  priorityInputsFromPlan,
  type PriorityInput,
  type ScoreContext,
  TOP_N,
} from "@/lib/priority";
import type { Plan } from "@/lib/scheduler";

const NOW = new Date(2026, 5, 1, 9, 0, 0); // Mon Jun 1 2026
const CTX: ScoreContext = { windowDays: 7, effortHours: 2, now: NOW };

function iso(offsetDays: number, hour = 17): string {
  return new Date(2026, 5, 1 + offsetDays, hour, 0, 0).toISOString();
}

function mk(over: Partial<PriorityInput> & { canvasId: number }): PriorityInput {
  return {
    name: `A${over.canvasId}`,
    courseName: "C",
    dueAt: iso(2),
    pointsPossible: 10,
    htmlUrl: null,
    atRisk: false,
    atRiskKind: null,
    shortfallHours: 0,
    scheduledHours: 0,
    submitted: false,
    ...over,
  };
}

describe("scoreAssignments", () => {
  it("ranks nearer due dates higher (urgency dominates)", () => {
    const s = scoreAssignments(
      [mk({ canvasId: 1, dueAt: iso(1) }), mk({ canvasId: 2, dueAt: iso(3) }), mk({ canvasId: 3, dueAt: iso(6) })],
      CTX,
    );
    const by = Object.fromEntries(s.map((x) => [x.canvasId, x.score]));
    expect(by[1]).toBeGreaterThan(by[2]);
    expect(by[2]).toBeGreaterThan(by[3]);
  });

  it("treats overdue as maximum urgency", () => {
    const [overdue, soon] = scoreAssignments(
      [mk({ canvasId: 1, dueAt: iso(-2) }), mk({ canvasId: 2, dueAt: iso(1) })],
      CTX,
    );
    expect(overdue.factors.urgency).toBe(1);
    expect(overdue.score).toBeGreaterThan(soon.score);
    expect(overdue.reason).toContain("Overdue");
  });

  it("weights higher points more; null points contributes no impact", () => {
    const [hi, lo, none] = scoreAssignments(
      [
        mk({ canvasId: 1, dueAt: iso(2), pointsPossible: 100 }),
        mk({ canvasId: 2, dueAt: iso(2), pointsPossible: 10 }),
        mk({ canvasId: 3, dueAt: iso(2), pointsPossible: null }),
      ],
      CTX,
    );
    expect(hi.score).toBeGreaterThan(lo.score);
    expect(lo.score).toBeGreaterThan(none.score);
    expect(none.factors.impact).toBe(0);
  });

  it("surfaces at-risk (insufficient_time) work above equal non-risk work", () => {
    const [risky, safe] = scoreAssignments(
      [
        mk({ canvasId: 1, dueAt: iso(2), atRisk: true, atRiskKind: "insufficient_time", shortfallHours: 2 }),
        mk({ canvasId: 2, dueAt: iso(2) }),
      ],
      CTX,
    );
    expect(risky.factors.risk).toBeGreaterThan(0);
    expect(risky.score).toBeGreaterThan(safe.score);
    expect(risky.reason).toContain("won't fit");
  });

  it("damps already-submitted work to the bottom", () => {
    const [open, done] = scoreAssignments(
      [mk({ canvasId: 1, dueAt: iso(1) }), mk({ canvasId: 2, dueAt: iso(1), submitted: true })],
      CTX,
    );
    expect(done.score).toBeLessThan(open.score);
    expect(done.score).toBeCloseTo(open.score * 0.1, 1);
  });

  it("keeps every score within 0..100 even for an extreme item", () => {
    const [s] = scoreAssignments(
      [mk({ canvasId: 1, dueAt: iso(-1), pointsPossible: 1000, atRisk: true, atRiskKind: "overdue", scheduledHours: 99 })],
      CTX,
    );
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThanOrEqual(100);
  });

  it("builds readable reason strings", () => {
    const [today, soon, overdue] = scoreAssignments(
      [
        mk({ canvasId: 1, dueAt: iso(0), pointsPossible: 30 }),
        mk({ canvasId: 2, dueAt: iso(1), pointsPossible: 50, atRisk: true, atRiskKind: "insufficient_time", shortfallHours: 1.5 }),
        mk({ canvasId: 3, dueAt: iso(-3), pointsPossible: 20 }),
      ],
      CTX,
    );
    expect(today.reason).toBe("Due today · 30 pts");
    expect(soon.reason).toBe("Due in 1 day · 50 pts · 1.5h won't fit");
    expect(overdue.reason).toBe("Overdue · 20 pts");
  });

  it("is deterministic for identical inputs", () => {
    const items = [mk({ canvasId: 1, dueAt: iso(1) }), mk({ canvasId: 2, dueAt: iso(2), pointsPossible: 80 })];
    expect(scoreAssignments(items, CTX)).toEqual(scoreAssignments(items, CTX));
  });
});

describe("rankRecommendations", () => {
  it("returns at most TOP_N items, highest score first", () => {
    const items = [1, 2, 3, 4, 5].map((id) => mk({ canvasId: id, dueAt: iso(id) }));
    const { top, ranked } = rankRecommendations(items, CTX);
    expect(top).toHaveLength(TOP_N);
    expect(ranked).toHaveLength(5);
    expect(top[0].score).toBeGreaterThanOrEqual(top[1].score);
    expect(top[0].canvasId).toBe(1); // due soonest
  });
});

describe("priorityInputsFromPlan", () => {
  it("merges scheduled hours + at-risk, threads points, and excludes undated", () => {
    const plan = {
      days: [
        { date: "", weekday: "", isToday: true, allocated: 0, capacity: 3, blocks: [
          { canvasId: 1, name: "Sched", courseName: "C1", hours: 1, htmlUrl: null, dueAt: iso(2) },
          { canvasId: 1, name: "Sched", courseName: "C1", hours: 1, htmlUrl: null, dueAt: iso(2) },
          { canvasId: 2, name: "Partial", courseName: "C2", hours: 1, htmlUrl: null, dueAt: iso(1) },
        ] },
      ],
      atRisk: [
        { canvasId: 2, name: "Partial", courseName: "C2", dueAt: iso(1), kind: "insufficient_time", shortfallHours: 1, htmlUrl: null },
        { canvasId: 3, name: "Late", courseName: "C3", dueAt: iso(-1), kind: "overdue", shortfallHours: 2, htmlUrl: null },
      ],
      undated: [{ canvasId: 9, name: "Someday", courseName: "C9", pointsPossible: 10, htmlUrl: null }],
    } as unknown as Plan;

    const inputs = priorityInputsFromPlan(plan, new Set<number>(), new Map([[1, 100], [2, 50], [3, 20]]));
    const byId = Object.fromEntries(inputs.map((i) => [i.canvasId, i]));

    expect(Object.keys(byId).sort()).toEqual(["1", "2", "3"]); // 9 (undated) excluded
    expect(byId[1].scheduledHours).toBe(2); // two blocks summed
    expect(byId[1].pointsPossible).toBe(100);
    expect(byId[2].atRisk).toBe(true);
    expect(byId[2].atRiskKind).toBe("insufficient_time");
    expect(byId[2].shortfallHours).toBe(1);
    expect(byId[3].atRiskKind).toBe("overdue");
  });
});
