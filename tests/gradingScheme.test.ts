// #144: the syllabus grading scheme — defensive parsing + confident-only matching.
import { describe, it, expect } from "vitest";
import { parseGradingScheme, matchCategory, type GradingScheme } from "@/lib/gradingScheme";

describe("parseGradingScheme", () => {
  it("fractions stay fractions", () => {
    expect(parseGradingScheme({ categories: [{ name: "Homework", weight: 0.2 }, { name: "Exams", weight: 0.8 }] })).toEqual({
      categories: [{ name: "Homework", weight: 0.2 }, { name: "Exams", weight: 0.8 }],
    });
  });
  it("percents are normalized to fractions (also '20%' strings)", () => {
    const s = parseGradingScheme({ categories: [{ name: "Homework", weight: "20%" }, { name: "Exams", weight: 80, count: 3 }] });
    expect(s?.categories?.[0].weight).toBeCloseTo(0.2, 9);
    expect(s?.categories?.[1]).toEqual({ name: "Exams", weight: 0.8, count: 3 });
  });
  it("over-100 sums are scaled down to sum to exactly 1", () => {
    const s = parseGradingScheme({ categories: [{ name: "A", weight: 60 }, { name: "B", weight: 60 }] })!;
    expect(s.categories!.reduce((t, c) => t + c.weight, 0)).toBeCloseTo(1, 9);
    expect(s.categories![0].weight).toBeCloseTo(0.5, 9);
  });
  it("an under-100 sum is left alone (unlisted categories keep their slice)", () => {
    const s = parseGradingScheme({ categories: [{ name: "Homework", weight: 30 }] })!;
    expect(s.categories![0].weight).toBeCloseTo(0.3, 9);
  });
  it("totalPoints kept only when positive; counts only as positive whole numbers", () => {
    expect(parseGradingScheme({ totalPoints: 1000 })).toEqual({ totalPoints: 1000 });
    expect(parseGradingScheme({ totalPoints: -5 })).toBeNull();
    expect(parseGradingScheme({ categories: [{ name: "HW", weight: 0.5, count: 0 }] })).toEqual({ categories: [{ name: "HW", weight: 0.5 }] });
    expect(parseGradingScheme({ categories: [{ name: "HW", weight: 0.5, count: 9.6 }] })?.categories?.[0].count).toBe(10);
  });
  it("MIXED units (decimals next to percents) → rejected, not guessed", () => {
    expect(parseGradingScheme({ categories: [{ name: "A", weight: 0.5 }, { name: "B", weight: 0.5 }, { name: "C", weight: 2 }] })).toBeNull();
    expect(parseGradingScheme({ totalPoints: 1000, categories: [{ name: "A", weight: 0.3 }, { name: "B", weight: 70 }] })).toBeNull();
    // exactly 1 among percents is 1%, not a decimal
    expect(parseGradingScheme({ categories: [{ name: "A", weight: 1 }, { name: "B", weight: 99 }] })?.categories?.[0].weight).toBeCloseTo(0.01, 9);
  });
  it("garbage → null, never throws", () => {
    for (const g of [null, undefined, 0, "", "20% homework", [], [1, 2], { categories: "x" }, { categories: [{ weight: 20 }, { name: "", weight: 5 }, { name: "X", weight: 0 }, { name: "Y", weight: "lots" }, null] }]) {
      expect(parseGradingScheme(g)).toBeNull();
    }
    const cyclic: Record<string, unknown> = {};
    cyclic.categories = [cyclic];
    expect(() => parseGradingScheme(cyclic)).not.toThrow();
  });
});

describe("matchCategory", () => {
  const scheme: GradingScheme = {
    categories: [
      { name: "Homework", weight: 0.2, count: 10 },
      { name: "Quizzes", weight: 0.1 },
      { name: "Midterm Exam", weight: 0.25 },
      { name: "Final Exam", weight: 0.3 },
      { name: "Participation", weight: 0.05 },
      { name: "Term Project", weight: 0.1 },
    ],
  };
  const cat = (n: string) => scheme.categories!.find((c) => c.name === n)!;

  it("group name first (case-insensitive, plural-tolerant, containment)", () => {
    expect(matchCategory(scheme, { groupName: "HOMEWORK", name: "Reading Quiz 3", type: "quiz" })).toBe(cat("Homework"));
    expect(matchCategory(scheme, { groupName: "Quiz", name: "Chapter 2", type: "assignment" })).toBe(cat("Quizzes"));
    expect(matchCategory(scheme, { groupName: "Homework Assignments", name: "Set 4", type: "assignment" })).toBe(cat("Homework"));
  });
  it("then keywords / type", () => {
    expect(matchCategory(scheme, { groupName: "Assignments", name: "Problem Set 2", type: "assignment" })).toBe(cat("Homework"));
    expect(matchCategory(scheme, { groupName: null, name: "Quiz 4", type: "quiz" })).toBe(cat("Quizzes"));
    expect(matchCategory(scheme, { groupName: null, name: "Midterm", type: "exam" })).toBe(cat("Midterm Exam"));
    expect(matchCategory(scheme, { groupName: null, name: "Final Exam (cumulative)", type: "exam" })).toBe(cat("Final Exam"));
    expect(matchCategory(scheme, { groupName: null, name: "Final Project Proposal", type: "assignment" })).toBe(cat("Term Project"));
    expect(matchCategory(scheme, { groupName: null, name: "Attendance week 3", type: "other" })).toBe(cat("Participation"));
    expect(matchCategory(scheme, { groupName: null, name: "Final", type: "exam" })).toBe(cat("Final Exam")); // type exam + "final"
  });
  it("null when not confident", () => {
    expect(matchCategory(scheme, { groupName: null, name: "Exam 2", type: "exam" })).toBeNull(); // midterm or final? unsure
    expect(matchCategory(scheme, { groupName: null, name: "Lab 1", type: "assignment" })).toBeNull(); // no lab category
    expect(matchCategory(scheme, { groupName: null, name: "Discussion: week 1", type: "other" })).toBeNull();
    // no keyword from the name or the group → not assumed to be homework
    expect(matchCategory(scheme, { groupName: null, name: "Case write-up", type: "assignment" })).toBeNull();
    expect(matchCategory(scheme, { groupName: "Week 3", name: "Chapter 4 reading response", type: "assignment" })).toBeNull();
    expect(matchCategory(null, { groupName: "Homework", name: "HW1", type: "assignment" })).toBeNull();
    expect(matchCategory({ totalPoints: 500 }, { groupName: "Homework", name: "HW1", type: "assignment" })).toBeNull();
  });
});

describe("matchCategory — 'final' alone never means the final exam", () => {
  const scheme: GradingScheme = {
    categories: [
      { name: "Final exam", weight: 0.3 },
      { name: "Homework", weight: 0.4 },
      { name: "Final Paper", weight: 0.2 },
      { name: "Finals", weight: 0.1 },
    ],
  };
  const finalExam = scheme.categories![0];
  it.each([
    ["Final Reflection", "assignment"],
    ["Final Paper", "assignment"],
    ["Final Presentation", "assignment"],
    ["Final Portfolio Submission", "other"],
    ["Final Draft", "assignment"],
  ] as const)("%s (%s) does not take the final-exam slice", (name, type) => {
    expect(matchCategory(scheme, { groupName: null, name, type })).not.toBe(finalExam);
  });
  it("an exam-typed item or an explicit exam word still matches an exam category", () => {
    const only: GradingScheme = { categories: [{ name: "Final exam", weight: 0.3 }, { name: "Homework", weight: 0.7 }] };
    expect(matchCategory(only, { groupName: null, name: "Final Exam", type: "exam" })).toBe(only.categories![0]);
    expect(matchCategory(only, { groupName: null, name: "Cumulative Final", type: "exam" })).toBe(only.categories![0]);
    expect(matchCategory(only, { groupName: null, name: "Final Reflection", type: "assignment" })).toBeNull();
  });
  it("a 'Final Paper' category is not an exam category", () => {
    const papers: GradingScheme = { categories: [{ name: "Final Paper", weight: 0.3 }, { name: "Homework", weight: 0.7 }] };
    expect(matchCategory(papers, { groupName: null, name: "Midterm", type: "exam" })).toBeNull();
  });
});

describe("gradeShareFor — zero points vs unknown points in a thin course", () => {
  it("0 points → share 0; unknown points → the type default", async () => {
    const { gradeShareFor, TYPE_PROXY_WEIGHT } = await import("@/lib/gradeWeight");
    const base = { canvasWeightedShare: null, scheme: null, category: null, postedTotalPoints: 130, postedPointedCount: 2, type: "assignment" as const };
    expect(gradeShareFor({ ...base, points: 0 }).share).toBe(0);
    expect(gradeShareFor({ ...base, points: null }).share).toBe(TYPE_PROXY_WEIGHT.assignment);
    expect(gradeShareFor({ ...base, points: 100 }).share).toBe(TYPE_PROXY_WEIGHT.assignment); // thin course: default, never 100/130
  });
});
