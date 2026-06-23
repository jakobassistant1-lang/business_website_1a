import { describe, it, expect } from "vitest";
import { computeGradeWeights, resolveWeight, TYPE_PROXY_WEIGHT, type GroupForWeight } from "@/lib/gradeWeight";

const w = (rows: ReturnType<typeof computeGradeWeights>, id: number) =>
  rows.find((r) => r.canvasId === id)?.gradeWeight ?? null;

describe("computeGradeWeights — weighted assignment groups", () => {
  it("splits each group's grade-share across its assignments by points", () => {
    const groups: GroupForWeight[] = [
      { id: 1, groupWeight: 60, assignments: [{ canvasId: 10, pointsPossible: 100 }] }, // Exams = 60%
      { id: 2, groupWeight: 40, assignments: [{ canvasId: 20, pointsPossible: 50 }, { canvasId: 21, pointsPossible: 50 }] }, // HW = 40%
    ];
    const r = computeGradeWeights(groups);
    expect(w(r, 10)).toBeCloseTo(0.6, 6); // the whole exam group
    expect(w(r, 20)).toBeCloseTo(0.2, 6); // half of 40%
    expect(w(r, 21)).toBeCloseTo(0.2, 6);
  });

  it("normalizes group weights that don't sum to 100", () => {
    const groups: GroupForWeight[] = [
      { id: 1, groupWeight: 30, assignments: [{ canvasId: 10, pointsPossible: 10 }] },
      { id: 2, groupWeight: 10, assignments: [{ canvasId: 20, pointsPossible: 10 }] },
    ]; // total 40 → shares 0.75 / 0.25
    const r = computeGradeWeights(groups);
    expect(w(r, 10)).toBeCloseTo(0.75, 6);
    expect(w(r, 20)).toBeCloseTo(0.25, 6);
  });

  it("a weighted group with no points yet splits evenly (its weight isn't lost)", () => {
    const groups: GroupForWeight[] = [
      { id: 1, groupWeight: 100, assignments: [{ canvasId: 10, pointsPossible: null }, { canvasId: 11, pointsPossible: 0 }] },
    ];
    const r = computeGradeWeights(groups);
    expect(w(r, 10)).toBeCloseTo(0.5, 6);
    expect(w(r, 11)).toBeCloseTo(0.5, 6);
  });
});

describe("computeGradeWeights — points-based courses (no group weights)", () => {
  it("share = points / total course points", () => {
    const groups: GroupForWeight[] = [
      { id: 1, groupWeight: 0, assignments: [{ canvasId: 10, pointsPossible: 50 }, { canvasId: 11, pointsPossible: 150 }] },
    ]; // total 200
    const r = computeGradeWeights(groups);
    expect(w(r, 10)).toBeCloseTo(0.25, 6);
    expect(w(r, 11)).toBeCloseTo(0.75, 6);
  });

  it("CALVIN'S CONSTRAINT: the same 50-pt assignment is worth a different SHARE in courses with different totals", () => {
    const smallCourse: GroupForWeight[] = [{ id: 1, groupWeight: null, assignments: [{ canvasId: 10, pointsPossible: 50 }, { canvasId: 11, pointsPossible: 50 }] }]; // total 100
    const bigCourse: GroupForWeight[] = [{ id: 1, groupWeight: null, assignments: [{ canvasId: 20, pointsPossible: 50 }, { canvasId: 21, pointsPossible: 450 }] }]; // total 500
    expect(w(computeGradeWeights(smallCourse), 10)).toBeCloseTo(0.5, 6); // 50 of 100
    expect(w(computeGradeWeights(bigCourse), 20)).toBeCloseTo(0.1, 6); // 50 of 500
  });

  it("a zero-point course yields null shares (caller falls back to the type proxy)", () => {
    const groups: GroupForWeight[] = [{ id: 1, groupWeight: null, assignments: [{ canvasId: 10, pointsPossible: 0 }] }];
    expect(w(computeGradeWeights(groups), 10)).toBeNull();
  });
});

describe("resolveWeight — fallback to the type proxy", () => {
  it("uses the computed share when present", () => {
    expect(resolveWeight(0.25, "assignment")).toBe(0.25);
  });
  it("falls back to the type proxy when the share is null/0", () => {
    expect(resolveWeight(null, "exam")).toBe(TYPE_PROXY_WEIGHT.exam);
    expect(resolveWeight(0, "quiz")).toBe(TYPE_PROXY_WEIGHT.quiz);
  });
  it("exam proxy outweighs quiz outweighs discussion (Q25: exam > quiz beyond points)", () => {
    expect(TYPE_PROXY_WEIGHT.exam).toBeGreaterThan(TYPE_PROXY_WEIGHT.quiz);
    expect(TYPE_PROXY_WEIGHT.quiz).toBeGreaterThan(TYPE_PROXY_WEIGHT.other);
  });
});
