import { describe, it, expect } from "vitest";
import { currentGrade, projectGrade, neededUniformScore, categoryBreakdown, gradeMode, type GradeInput } from "../lib/gradeCalc";

// Small builder — defaults to an ungraded, unweighted 100-point item.
function gi(over: Partial<GradeInput> & { canvasId: number }): GradeInput {
  return { name: "Item", pointsPossible: 100, score: null, groupId: null, groupName: null, groupWeight: null, ...over };
}

describe("gradeMode", () => {
  it("is weighted when any group carries a weight, else points", () => {
    expect(gradeMode([gi({ canvasId: 1 })])).toBe("points");
    expect(gradeMode([gi({ canvasId: 1, groupId: 1, groupWeight: 40 })])).toBe("weighted");
    expect(gradeMode([gi({ canvasId: 1, groupId: 1, groupWeight: 0 })])).toBe("points");
  });
});

describe("points mode", () => {
  const items = [gi({ canvasId: 1, score: 80 }), gi({ canvasId: 2 })]; // 80/100 graded + 100pts remaining

  it("current grade ignores ungraded work", () => {
    expect(currentGrade(items)).toBe(80);
  });

  it("projects a what-if score", () => {
    expect(projectGrade(items, new Map([[2, 90]]))).toBeCloseTo(85, 5); // (80+90)/200
  });

  it("solves the uniform score needed for a target", () => {
    const r = neededUniformScore(items, 85);
    expect(r).toEqual({ kind: "score", value: 90 });
  });

  it("reports 'secured' when a zero on the rest still clears the target", () => {
    const small = [gi({ canvasId: 1, score: 90 }), gi({ canvasId: 2, pointsPossible: 10 })]; // 90/100 + 10pts left
    expect(neededUniformScore(small, 80)).toEqual({ kind: "secured" });
  });
});

describe("weighted mode (Canvas group_weight)", () => {
  const exam = (o: Partial<GradeInput> & { canvasId: number }) => gi({ groupId: 1, groupName: "Exams", groupWeight: 70, ...o });
  const hw = (o: Partial<GradeInput> & { canvasId: number }) => gi({ groupId: 2, groupName: "Homework", groupWeight: 30, ...o });

  it("weights each category's points-based average", () => {
    const items = [exam({ canvasId: 1, score: 80 }), hw({ canvasId: 2, score: 90 })];
    expect(currentGrade(items)).toBeCloseTo(83, 5); // .7*80 + .3*90
  });

  it("needs a full 100 on the final to lift an 83 to a 90", () => {
    const items = [exam({ canvasId: 1, score: 80 }), hw({ canvasId: 2, score: 90 }), exam({ canvasId: 3, name: "Final" })];
    expect(neededUniformScore(items, 90)).toEqual({ kind: "score", value: 100 });
  });

  it("flags an out-of-reach target as impossible", () => {
    const items = [exam({ canvasId: 1, score: 80 }), hw({ canvasId: 2, score: 90 }), exam({ canvasId: 3, name: "Final" })];
    expect(neededUniformScore(items, 95)).toEqual({ kind: "impossible" });
  });
});

describe("categoryBreakdown", () => {
  it("returns each weighted group's graded average and counts", () => {
    const items = [
      gi({ canvasId: 1, groupId: 1, groupName: "Exams", groupWeight: 70, score: 80 }),
      gi({ canvasId: 2, groupId: 1, groupName: "Exams", groupWeight: 70 }), // remaining
      gi({ canvasId: 3, groupId: 2, groupName: "Homework", groupWeight: 30, score: 90 }),
    ];
    const rows = categoryBreakdown(items).sort((a, b) => (a.groupId ?? 0) - (b.groupId ?? 0));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: "Exams", weight: 70, average: 80, gradedCount: 1, remainingCount: 1 });
    expect(rows[1]).toMatchObject({ name: "Homework", weight: 30, average: 90, gradedCount: 1, remainingCount: 0 });
  });
});
