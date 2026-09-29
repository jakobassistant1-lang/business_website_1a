// GRADE CANON (owner, 2026-09-28): "Current grade" is ALWAYS Canvas's own number
// and letter — what GradePill shows. The Grades tab (GradeCalculator) shows THAT as
// "Current grade"; its own recomputation appears only under "What-if", or — when
// the teacher hides the total — labelled "Estimated from your graded work" (never
// "Current grade"). No second letter scale. Behaviour first: the pure rule, then
// the rendered component.
import { describe, it, expect, beforeAll } from "vitest";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import { anchoredNeeded, anchoredProjection, gradeHeadline, gradedWorkEstimate, keepUpScores, neededUniformScore, whatIfOffset, type GradeInput } from "@/lib/gradeCalc";
import { gradePercentText, type CourseGrade } from "@/lib/courseGrade";
import { GradeCalculator } from "@/components/GradeCalculator";
import { GradePill } from "@/components/GradePill";

// The app compiles JSX with the classic runtime (tsconfig "jsx": "preserve" → esbuild
// emits React.createElement), so the components need `React` in scope when rendered here.
beforeAll(() => {
  (globalThis as unknown as { React: typeof React }).React = React;
});

const gi = (o: Partial<GradeInput> & { canvasId: number }): GradeInput => ({ name: `Item ${o.canvasId}`, pointsPossible: 100, score: null, groupId: null, groupName: null, groupWeight: null, ...o });
// Our math says 83% (.7×80 + .3×90); Canvas says 88.6 B+ (it dropped a low score, say).
const ITEMS: GradeInput[] = [
  gi({ canvasId: 1, name: "Exam 1", score: 80, groupId: 1, groupName: "Exams", groupWeight: 70 }),
  gi({ canvasId: 2, name: "Homework", score: 90, groupId: 2, groupName: "Homework", groupWeight: 30 }),
  gi({ canvasId: 3, name: "Final", groupId: 1, groupName: "Exams", groupWeight: 70 }),
];
const CANVAS: CourseGrade = { state: "graded", score: 88.6, letter: "B+" };
const HIDDEN: CourseGrade = { state: "hidden", score: null, letter: null };
const NONE: CourseGrade = { state: "none", score: null, letter: null };

describe("gradeHeadline — the one rule for what the Grades tab leads with", () => {
  it("Canvas has a total → 'Current grade' is Canvas's number and Canvas's letter", () => {
    const h = gradeHeadline(CANVAS, 83);
    expect(h).toMatchObject({ label: "Current grade", value: "89%", letter: "B+", start: 88.6 });
  });
  it("…and it prints exactly what GradePill prints", () => {
    const pill = renderToStaticMarkup(createElement(GradePill, { grade: CANVAS }));
    expect(pill).toContain(`>${gradeHeadline(CANVAS, 83).value}<`);
    expect(pill).toContain(">B+<");
  });
  it("no Canvas letter → no letter (we never invent one from a scale)", () => {
    expect(gradeHeadline({ state: "graded", score: 91, letter: null }, 70).letter).toBeNull();
  });
  it("teacher hides totals → 'Estimated from your graded work', never 'Current grade', no letter", () => {
    const h = gradeHeadline(HIDDEN, 83);
    expect(h).toMatchObject({ label: "Estimated from your graded work", value: "83%", letter: null, start: 83 });
    expect(h.note).toMatch(/hides the course total/);
  });
  it("nothing graded → 'Current grade' — / No grades yet", () => {
    expect(gradeHeadline(NONE, null)).toMatchObject({ label: "Current grade", value: "—", letter: null, start: null, note: "No grades yet" });
  });
  it("the graded-work figure is the calculator's own estimate (83 here), kept apart from Canvas's", () => {
    expect(gradedWorkEstimate(ITEMS)).toBeCloseTo(83, 5);
    expect(gradePercentText(88.6)).toBe("89%");
  });
});

describe("GradeCalculator renders the canon", () => {
  const text = (html: string) => html.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|");

  it("with a Canvas total: 'Current grade' is Canvas's 89% B+ (phone tile AND desktop row); our 83% appears nowhere", () => {
    const html = renderToStaticMarkup(createElement(GradeCalculator, { items: ITEMS, official: CANVAS }));
    const t = text(html);
    expect(t.match(/\|Current grade\|89%\|/g)?.length).toBeGreaterThanOrEqual(1); // phone tile
    expect(t).toMatch(/\|Current grade\|From Canvas\|89%\|B\+\|/); // md+ row
    expect(t).not.toContain("|83%|"); // (the "B (83%)" target option is a target, not a grade)
    expect(t).not.toContain("Estimated from your graded work");
    // the what-if starts from Canvas's number and lives under its own heading
    expect(t).toContain("|What-if|");
    expect(t).toContain("Starts from 89%.");
    // untouched, the what-if IS Canvas's number (anchored), not our 86%
    expect(t).toContain("|If you keep up your current averages|89%|");
    expect(t.indexOf("|What-if|")).toBeGreaterThan(t.lastIndexOf("|Current grade|"));
  });

  it("with totals hidden: the header keeps 'Grades hidden' (GradePill); the calculator labels its 83% as an estimate", () => {
    expect(renderToStaticMarkup(createElement(GradePill, { grade: HIDDEN }))).toContain("Grades hidden");
    const t = text(renderToStaticMarkup(createElement(GradeCalculator, { items: ITEMS, official: HIDDEN })));
    expect(t).toContain("|Estimated from your graded work|83%|");
    expect(t).not.toContain("Current grade");
    expect(t).toContain("Starts from 83%.");
  });

  it("explains what the what-if does and why it can differ — without the old hedge", () => {
    const t = text(renderToStaticMarkup(createElement(GradeCalculator, { items: ITEMS, official: CANVAS })));
    expect(t).toContain("What-ifs use your Canvas category weights");
    expect(t).toContain("They’re lined up with Canvas’s number, which can also count dropped low scores, extra credit and excused work.");
    expect(t).not.toMatch(/may weight categories differently/);
    const points = text(renderToStaticMarkup(createElement(GradeCalculator, { items: ITEMS.map((i) => ({ ...i, groupWeight: null })), official: CANVAS })));
    expect(points).toContain("What-ifs add up points across all your work");
    expect(points).not.toMatch(/may weight categories differently/);
  });

  it("the only letter shown FOR A GRADE is Canvas's; the target picker states its scale plainly", () => {
    const src = readFileSync("components/GradeCalculator.tsx", "utf8");
    expect(src).not.toMatch(/function letterFor|letterFor\(/);
    const t = text(renderToStaticMarkup(createElement(GradeCalculator, { items: ITEMS, official: { state: "graded", score: 88.6, letter: null } })));
    // grade figures are bare percentages — no computed "B" beside any of them
    expect(t).toContain("|If you keep up your current averages|89%|");
    expect(t).not.toMatch(/\|\d+%\|[A-F][+−-]?\|/);
    // the targets ARE letters on the standard scale, and the screen says so — no hedging
    expect(t).toContain("|Targets use the standard scale: A 93, A− 90, B+ 87, B 83, C 73.|");
    expect(src).not.toMatch(/\b(may|might)\b[^"]*scale/);
  });
});

describe("the anchored what-if (review 2026-09-28): no change ⇒ exactly Canvas's number", () => {
  const estimate = gradedWorkEstimate(ITEMS)!; // 83
  const offset = whatIfOffset(CANVAS, estimate);

  it("the anchor is Canvas − our estimate; 0 when Canvas shows no total", () => {
    expect(offset).toBeCloseTo(88.6 - 83, 5);
    expect(whatIfOffset(HIDDEN, estimate)).toBe(0);
    expect(whatIfOffset(NONE, null)).toBe(0);
    expect(whatIfOffset(CANVAS, null)).toBe(0);
  });
  it("'keep it up' seeds reproduce today's estimate, so the untouched projection === Canvas current", () => {
    const seeds = keepUpScores(ITEMS);
    expect(seeds.get(3)).toBeCloseTo(80, 5); // the Final sits at the Exams average
    expect(anchoredProjection(ITEMS, seeds, offset)).toBeCloseTo(88.6, 6);
    // points mode and an ungraded category too
    const mixed = [...ITEMS, gi({ canvasId: 4, groupId: 5, groupName: "Labs", groupWeight: 20 })];
    const off2 = whatIfOffset(CANVAS, gradedWorkEstimate(mixed));
    expect(anchoredProjection(mixed, keepUpScores(mixed), off2)).toBeCloseTo(88.6, 6);
    const points = ITEMS.map((i) => ({ ...i, groupWeight: null }));
    const off3 = whatIfOffset(CANVAS, gradedWorkEstimate(points));
    expect(anchoredProjection(points, keepUpScores(points), off3)).toBeCloseTo(88.6, 6);
  });
  it("with totals hidden there is no shift: the projection is our own estimate", () => {
    expect(anchoredProjection(ITEMS, keepUpScores(ITEMS), 0)).toBeCloseTo(83, 6);
  });
  it("moving the what-if moves it from Canvas's number by exactly what our math says", () => {
    const all100 = new Map([[3, 100]]);
    expect(anchoredProjection(ITEMS, all100, offset)! - 88.6).toBeCloseTo(anchoredProjection(ITEMS, all100, 0)! - estimate, 6);
  });
  it("the 'needed for' solver uses the same anchor (target shifted), so it agrees with the projection", () => {
    const need = anchoredNeeded(ITEMS, 90, offset);
    expect(need).toEqual(neededUniformScore(ITEMS, 90 - offset));
    if (need.kind === "score") expect(anchoredProjection(ITEMS, new Map([[3, need.value]]), offset)!).toBeGreaterThanOrEqual(90);
  });
  it("the component wires them: anchored projection + solver, keep-up seeds", () => {
    const src = readFileSync("components/GradeCalculator.tsx", "utf8");
    expect(src).toContain("const offset = whatIfOffset(official, estimate);");
    expect(src).toContain("anchoredProjection(gradeables, assume, offset)");
    expect(src).toContain("anchoredNeeded(gradeables, target, offset)");
    expect(src).toContain("keepUpScores(gradeables)");
    expect(src).not.toMatch(/projectGrade\(|neededUniformScore\(/);
  });
});
