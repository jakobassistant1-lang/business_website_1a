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
  it("falls back to the type proxy only for an indeterminate share (null/undefined/negative)", () => {
    expect(resolveWeight(null, "exam")).toBe(TYPE_PROXY_WEIGHT.exam);
    expect(resolveWeight(undefined, "exam")).toBe(TYPE_PROXY_WEIGHT.exam);
    expect(resolveWeight(-1, "quiz")).toBe(TYPE_PROXY_WEIGHT.quiz);
  });
  it("honors an explicit 0 (a group/item that genuinely doesn't count → low priority, NOT the proxy)", () => {
    expect(resolveWeight(0, "quiz")).toBe(0);
    expect(resolveWeight(0, "assignment")).toBe(0);
  });
  it("exam proxy outweighs quiz outweighs discussion (Q25: exam > quiz beyond points)", () => {
    expect(TYPE_PROXY_WEIGHT.exam).toBeGreaterThan(TYPE_PROXY_WEIGHT.quiz);
    expect(TYPE_PROXY_WEIGHT.quiz).toBeGreaterThan(TYPE_PROXY_WEIGHT.other);
  });
});

// --- #144: THE grade-share rule --------------------------------------------------
import { gradeShareFor, courseGradeShares, usesGroupWeights, THIN_COURSE_MIN_ITEMS, type GradeShareInput, type ShareItem } from "@/lib/gradeWeight";

const base: GradeShareInput = {
  canvasWeightedShare: null,
  scheme: null,
  category: null,
  points: 100,
  postedTotalPoints: 100,
  postedPointedCount: 1,
  type: "assignment",
};

describe("gradeShareFor — the owner's order", () => {
  it("THIN_COURSE_MIN_ITEMS is 5", () => {
    expect(THIN_COURSE_MIN_ITEMS).toBe(5);
  });
  it("1. Canvas weighted groups win (explicit 0 kept)", () => {
    expect(gradeShareFor({ ...base, canvasWeightedShare: 0.15, scheme: { totalPoints: 1000 } })).toEqual({ share: 0.15, source: "canvas_groups" });
    expect(gradeShareFor({ ...base, canvasWeightedShare: 0 })).toEqual({ share: 0, source: "canvas_groups" });
    expect(gradeShareFor({ ...base, canvasWeightedShare: 3 }).share).toBe(1);
  });
  it("2. syllabus categories: weight ÷ max(syllabus count, posted in category) — Homework 20% / 10 items → 0.02 with only 2 posted", () => {
    const r = gradeShareFor({ ...base, points: 10, category: { weight: 0.2, count: 10, postedInCategory: 2 } });
    expect(r.source).toBe("syllabus_categories");
    expect(r.share).toBeCloseTo(0.02, 9);
    // more posted than the syllabus said → split across what's posted
    expect(gradeShareFor({ ...base, category: { weight: 0.2, count: 2, postedInCategory: 4 } }).share).toBeCloseTo(0.05, 9);
    // no syllabus count → split across posted
    expect(gradeShareFor({ ...base, category: { weight: 0.3, postedInCategory: 3 } }).share).toBeCloseTo(0.1, 9);
    // a 0-point item counts for nothing
    expect(gradeShareFor({ ...base, points: 0, category: { weight: 0.2, count: 10, postedInCategory: 2 } })).toEqual({ share: 0, source: "syllabus_categories" });
  });
  it("3. syllabus point total: points ÷ totalPoints", () => {
    expect(gradeShareFor({ ...base, points: 50, scheme: { totalPoints: 1000 } })).toEqual({ share: 0.05, source: "syllabus_total" });
  });
  it("Managerial Economics: ONE 100-pt item posted, no scheme → the assignment default 0.06, NOT 1.0", () => {
    const r = gradeShareFor({ ...base, points: 100, postedTotalPoints: 100, postedPointedCount: 1, type: "assignment" });
    expect(r).toEqual({ share: TYPE_PROXY_WEIGHT.assignment, source: "default" });
    expect(r.share).toBe(0.06);
    expect(gradeShareFor({ ...base, postedPointedCount: 4, type: "exam" })).toEqual({ share: 0.25, source: "default" });
  });
  it("4. posted points once ≥ 5 pointed items are posted (6-item course)", () => {
    const r = gradeShareFor({ ...base, points: 50, postedTotalPoints: 400, postedPointedCount: 6 });
    expect(r).toEqual({ share: 0.125, source: "posted_points" });
    expect(gradeShareFor({ ...base, points: 50, postedTotalPoints: 250, postedPointedCount: 5 }).source).toBe("posted_points");
  });
  it("5. unknown points → type default; always 0..1", () => {
    expect(gradeShareFor({ ...base, points: null, postedPointedCount: 9, postedTotalPoints: 900, type: "quiz" })).toEqual({ share: 0.08, source: "default" });
    expect(gradeShareFor({ ...base, points: 5000, scheme: { totalPoints: 100 } }).share).toBe(1);
  });
});

describe("courseGradeShares — one course through gradeShareFor", () => {
  const hw = (id: number, points: number | null = 10): ShareItem => ({ canvasId: id, name: `Homework ${id}`, points, groupName: "Homework", type: "assignment" });

  it("thin course: one posted 100-pt item → default, not the whole grade", () => {
    const m = courseGradeShares([{ canvasId: 1, name: "Case Study 1", points: 100, groupName: "Assignments", type: "assignment" }], { canvasWeighted: null, scheme: null });
    expect(m.get(1)).toEqual({ share: 0.06, source: "default" });
  });
  it("6 pointed items, no scheme → posted points", () => {
    const items = [1, 2, 3, 4, 5, 6].map((i) => hw(i, i === 6 ? 50 : 10));
    const m = courseGradeShares(items, { canvasWeighted: null, scheme: null });
    expect(m.get(6)).toEqual({ share: 0.5, source: "posted_points" });
    expect(m.get(1)?.share).toBeCloseTo(0.1, 9);
  });
  it("syllabus categories count only the pointed items posted in that category", () => {
    const scheme = { categories: [{ name: "Homework", weight: 0.2, count: 10 }, { name: "Exams", weight: 0.8, count: 2 }] };
    const m = courseGradeShares([hw(1), hw(2), { canvasId: 3, name: "Midterm", points: 100, groupName: "Exams", type: "exam" }], { canvasWeighted: null, scheme });
    expect(m.get(1)?.share).toBeCloseTo(0.02, 9);
    expect(m.get(2)?.source).toBe("syllabus_categories");
    expect(m.get(3)?.share).toBeCloseTo(0.4, 9);
  });
  it("Canvas weighted groups beat the syllabus", () => {
    const m = courseGradeShares([hw(1)], { canvasWeighted: new Map([[1, 0.3]]), scheme: { totalPoints: 1000 } });
    expect(m.get(1)).toEqual({ share: 0.3, source: "canvas_groups" });
  });
  it("usesGroupWeights detects a weighted course", () => {
    expect(usesGroupWeights([{ groupWeight: 0 }, { groupWeight: null }])).toBe(false);
    expect(usesGroupWeights([{ groupWeight: 0 }, { groupWeight: 40 }])).toBe(true);
  });
});

describe("review fixes: shares never sum past 1", () => {
  const sumOf = (m: Map<number, { share: number }>) => [...m.values()].reduce((s, x) => s + x.share, 0);

  it("no points → 0 in the category step (never a full category slice)", () => {
    expect(gradeShareFor({ ...base, points: null, category: { weight: 0.2, count: 10, postedInCategory: 2 } })).toEqual({ share: 0, source: "syllabus_categories" });
  });

  it("syllabus total below the points already posted → divide by the larger (1000 stated, 1200 posted)", () => {
    expect(gradeShareFor({ ...base, points: 120, postedTotalPoints: 1200, postedPointedCount: 12, scheme: { totalPoints: 1000 } })).toEqual({ share: 0.1, source: "syllabus_total" });
  });

  it("unmatched items share only the UNCLAIMED remainder (Exams 0.6 + Quizzes 0.2 → labs split 0.2 by points)", () => {
    const scheme = { categories: [{ name: "Exams", weight: 0.6, count: 3 }, { name: "Quizzes", weight: 0.2, count: 10 }] };
    const items: ShareItem[] = [
      { canvasId: 1, name: "Midterm 1", points: 100, groupName: null, type: "exam" },
      { canvasId: 2, name: "Quiz 1", points: 10, groupName: null, type: "quiz" },
      { canvasId: 3, name: "Lab 1", points: 30, groupName: null, type: "assignment" },
      { canvasId: 4, name: "Lab 2", points: 10, groupName: null, type: "assignment" },
    ];
    const m = courseGradeShares(items, { canvasWeighted: null, scheme });
    expect(m.get(3)?.share).toBeCloseTo(0.15, 9);
    expect(m.get(4)?.share).toBeCloseTo(0.05, 9);
    expect(sumOf(m)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("Σ shares ≤ 1 for a realistic 25-item course in every source mode", () => {
    // 10 homework (10 pts), 10 quizzes (20 pts), 3 exams (100 pts), 1 project (150 pts), 1 participation (50 pts)
    const items: ShareItem[] = [
      ...Array.from({ length: 10 }, (_, i) => ({ canvasId: 100 + i, name: `Homework ${i + 1}`, points: 10, groupName: "Homework", type: "assignment" as const })),
      ...Array.from({ length: 10 }, (_, i) => ({ canvasId: 200 + i, name: `Quiz ${i + 1}`, points: 20, groupName: "Quizzes", type: "quiz" as const })),
      ...Array.from({ length: 3 }, (_, i) => ({ canvasId: 300 + i, name: i === 2 ? "Final Exam" : `Midterm ${i + 1}`, points: 100, groupName: "Exams", type: "exam" as const })),
      { canvasId: 400, name: "Final Project", points: 150, groupName: "Projects", type: "assignment" },
      { canvasId: 500, name: "Participation", points: 50, groupName: "Participation", type: "other" },
    ];
    expect(items).toHaveLength(25);
    const weighted = new Map(
      computeGradeWeights([
        { id: 1, groupWeight: 20, assignments: items.slice(0, 10).map((i) => ({ canvasId: i.canvasId, pointsPossible: i.points })) },
        { id: 2, groupWeight: 20, assignments: items.slice(10, 20).map((i) => ({ canvasId: i.canvasId, pointsPossible: i.points })) },
        { id: 3, groupWeight: 45, assignments: items.slice(20, 23).map((i) => ({ canvasId: i.canvasId, pointsPossible: i.points })) },
        { id: 4, groupWeight: 15, assignments: items.slice(23).map((i) => ({ canvasId: i.canvasId, pointsPossible: i.points })) },
      ]).map((w) => [w.canvasId, w.gradeWeight] as const),
    );
    const modes: Record<string, { items: ShareItem[]; ctx: Parameters<typeof courseGradeShares>[1]; source: string }> = {
      canvas_groups: { items, ctx: { canvasWeighted: weighted, scheme: null }, source: "canvas_groups" },
      syllabus_categories: {
        items,
        ctx: { canvasWeighted: null, scheme: { categories: [{ name: "Homework", weight: 0.15, count: 12 }, { name: "Quizzes", weight: 0.15 }, { name: "Exams", weight: 0.5, count: 3 }] } },
        source: "syllabus_categories",
      },
      syllabus_total: { items, ctx: { canvasWeighted: null, scheme: { totalPoints: 500 } }, source: "syllabus_total" }, // below the 800 posted
      posted_points: { items, ctx: { canvasWeighted: null, scheme: null }, source: "posted_points" },
      default: { items: items.map((i) => ({ ...i, points: null })), ctx: { canvasWeighted: null, scheme: null }, source: "default" },
    };
    for (const [mode, { items: its, ctx, source }] of Object.entries(modes)) {
      const m = courseGradeShares(its, ctx);
      const total = sumOf(m);
      console.log(`[share sum] ${mode}: Σ = ${total.toFixed(4)} over ${m.size} items`);
      expect([...m.values()].some((x) => x.source === source)).toBe(true);
      expect(total).toBeLessThanOrEqual(1 + 1e-9);
      for (const x of m.values()) expect(x.share).toBeGreaterThanOrEqual(0);
    }
  });

  it("the thin-course default is untouched when it already fits (Managerial Economics stays 0.06)", () => {
    const m = courseGradeShares([{ canvasId: 1, name: "Case 1", points: 100, groupName: null, type: "assignment" }], { canvasWeighted: null, scheme: null });
    expect(m.get(1)?.share).toBe(0.06);
  });
});

describe("coordinator rule: a graded item never gets 0 for an unmatched name", () => {
  const sumOf = (m: Map<number, { share: number }>) => [...m.values()].reduce((s, x) => s + x.share, 0);

  it("categories summing to 1.0 + an unmatched 50-point 'Case Study' → share > 0 and Σ ≤ 1", () => {
    const scheme = { categories: [{ name: "Homework", weight: 0.4, count: 4 }, { name: "Exams", weight: 0.6, count: 2 }] };
    const items: ShareItem[] = [
      ...[1, 2, 3, 4].map((i) => ({ canvasId: i, name: `Homework ${i}`, points: 10, groupName: null, type: "assignment" as const })),
      { canvasId: 5, name: "Midterm", points: 100, groupName: null, type: "exam" },
      { canvasId: 6, name: "Final Exam", points: 100, groupName: null, type: "exam" },
      { canvasId: 7, name: "Case Study", points: 50, groupName: null, type: "assignment" },
    ];
    const m = courseGradeShares(items, { canvasWeighted: null, scheme });
    expect(m.get(7)!.share).toBeGreaterThan(0);
    expect(m.get(7)!.source).toBe("posted_points"); // fell through: 7 pointed items posted ≥ 5
    expect(sumOf(m)).toBeLessThanOrEqual(1 + 1e-9);
    for (const x of m.values()) expect(x.share).toBeGreaterThan(0);
  });

  it("fall-through with a thin course lands on the type default (still > 0, Σ ≤ 1)", () => {
    const scheme = { categories: [{ name: "Exams", weight: 1 }] };
    const m = courseGradeShares(
      [
        { canvasId: 1, name: "Midterm", points: 100, groupName: null, type: "exam" },
        { canvasId: 2, name: "Case Study", points: 50, groupName: null, type: "assignment" },
      ],
      { canvasWeighted: null, scheme },
    );
    expect(m.get(2)!.source).toBe("default");
    expect(m.get(2)!.share).toBeGreaterThan(0);
    expect(sumOf(m)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("categories summing to 0.8 → unmatched items split the 0.2 by points", () => {
    const scheme = { categories: [{ name: "Exams", weight: 0.6, count: 2 }, { name: "Quizzes", weight: 0.2, count: 4 }] };
    const items: ShareItem[] = [
      { canvasId: 1, name: "Midterm", points: 100, groupName: null, type: "exam" },
      { canvasId: 2, name: "Quiz 1", points: 10, groupName: null, type: "quiz" },
      { canvasId: 3, name: "Case Study", points: 60, groupName: null, type: "assignment" },
      { canvasId: 4, name: "Memo", points: 20, groupName: null, type: "assignment" },
    ];
    const m = courseGradeShares(items, { canvasWeighted: null, scheme });
    expect(m.get(3)).toEqual({ share: expect.closeTo(0.15, 9), source: "syllabus_categories" });
    expect(m.get(4)).toEqual({ share: expect.closeTo(0.05, 9), source: "syllabus_categories" });
    expect(sumOf(m)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("only no-point / 0-point items may get 0", () => {
    const scheme = { categories: [{ name: "Exams", weight: 1 }] };
    const m = courseGradeShares(
      [
        { canvasId: 1, name: "Midterm", points: 100, groupName: null, type: "exam" },
        { canvasId: 2, name: "Reading", points: null, groupName: null, type: "assignment" },
        { canvasId: 3, name: "Survey", points: 0, groupName: null, type: "other" },
      ],
      { canvasWeighted: null, scheme },
    );
    expect(m.get(2)!.share).toBe(0);
    expect(m.get(3)!.share).toBe(0);
    expect(m.get(1)!.share).toBeGreaterThan(0);
  });
});
