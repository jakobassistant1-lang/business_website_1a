// Acceptance suite for the v1 prioritizer — encodes Calvin's revealed preferences
// (docs/navo-priority-preferences.md): the 25 pairwise answers + the 3 validation
// scenarios. These tests ARE the spec's §8 acceptance set; the model's constants
// exist to keep them green. Ranking is by IMPORTANCE (`value` = leverage·capture).

import { describe, it, expect } from "vitest";
import { scoreItem, rankItems, type MarginalInput } from "@/lib/marginalPriority";
import type { LatePolicy } from "@/lib/latePolicy";

const NONE: LatePolicy = { kind: "none", value: 0 };
const PERDAY10: LatePolicy = { kind: "perday", value: 0.1 };

function mk(o: Partial<MarginalInput> & { canvasId: number }): MarginalInput {
  return {
    name: `A${o.canvasId}`,
    courseName: "C",
    kind: "assignment",
    weight: 0.1,
    courseGrade: null,
    dueInDays: 3,
    effortHours: 2,
    latePolicy: NONE,
    submitted: false,
    ...o,
  };
}
const study = (o: Partial<MarginalInput> & { canvasId: number }) => mk({ kind: "study", ...o });
const val = (i: MarginalInput) => scoreItem(i).value;
/** A outranks B by importance. */
const beats = (a: MarginalInput, b: MarginalInput) => val(a) > val(b);
const closeness = (a: MarginalInput, b: MarginalInput) =>
  Math.abs(val(a) - val(b)) / Math.max(val(a), val(b));

// Within one course, weight ∝ points, so raw points stand in as the weight.
describe("imminence tier (Q1–Q4)", () => {
  it("Q1: 30pt due tomorrow > 90pt in 4 days", () => {
    expect(beats(mk({ canvasId: 1, weight: 30, dueInDays: 1 }), mk({ canvasId: 2, weight: 90, dueInDays: 4 }))).toBe(true);
  });
  it("Q2: 15pt tomorrow > 200pt in 3 days (imminence near-absolute, ~13× gap doesn't flip)", () => {
    expect(beats(mk({ canvasId: 1, weight: 15, dueInDays: 1 }), mk({ canvasId: 2, weight: 200, dueInDays: 3 }))).toBe(true);
  });
  it("Q3: among non-imminent, weight wins — 180pt in 4d > 40pt in 3d", () => {
    expect(beats(mk({ canvasId: 2, weight: 180, dueInDays: 4 }), mk({ canvasId: 1, weight: 40, dueInDays: 3 }))).toBe(true);
  });
  it("Q4: 2 days is still imminent — 20pt in 2d > 150pt in 4d", () => {
    expect(beats(mk({ canvasId: 1, weight: 20, dueInDays: 2 }), mk({ canvasId: 2, weight: 150, dueInDays: 4 }))).toBe(true);
  });
});

describe("studying vs doing (Q5–Q8, Q16, Q17, Q20)", () => {
  it("Q5: do 100pt = study 100pt exam (both 3d) → doing wins", () => {
    expect(beats(mk({ canvasId: 1, weight: 100, dueInDays: 3 }), study({ canvasId: 2, weight: 100, dueInDays: 3 }))).toBe(true);
  });
  it("Q6: study a 200pt final (3d) > do a 30pt assignment (3d)", () => {
    expect(beats(study({ canvasId: 2, weight: 200, dueInDays: 3 }), mk({ canvasId: 1, weight: 30, dueInDays: 3 }))).toBe(true);
  });
  it("Q16: study 100pt exam (3d) > do 50pt (3d)", () => {
    expect(beats(study({ canvasId: 2, weight: 100, dueInDays: 3 }), mk({ canvasId: 1, weight: 50, dueInDays: 3 }))).toBe(true);
  });
  it("Q17: study 100pt exam (3d) ≈ do 75pt (3d) — a genuine close call", () => {
    expect(closeness(study({ canvasId: 2, weight: 100, dueInDays: 3 }), mk({ canvasId: 1, weight: 75, dueInDays: 3 }))).toBeLessThan(0.15);
  });
  it("Q20: studying ramps with time — do 50pt (3d) > study 100pt exam 5 DAYS out", () => {
    expect(beats(mk({ canvasId: 1, weight: 50, dueInDays: 3 }), study({ canvasId: 2, weight: 100, dueInDays: 5 }))).toBe(true);
  });
  it("Q8: an imminent high-stakes exam tops a small same-day assignment — study 100pt exam TOMORROW > do 25pt due today", () => {
    expect(beats(study({ canvasId: 2, weight: 100, dueInDays: 1 }), mk({ canvasId: 1, weight: 25, dueInDays: 0 }))).toBe(true);
  });
  it("Q7: do 30pt tomorrow > study 100pt exam in 2 days — but close", () => {
    const a = mk({ canvasId: 1, weight: 30, dueInDays: 1 });
    const b = study({ canvasId: 2, weight: 100, dueInDays: 2 });
    expect(beats(a, b)).toBe(true);
    expect(closeness(a, b)).toBeLessThan(0.25);
  });
});

describe("grade-leverage (Q15, Q21, Q18)", () => {
  it("Q15: equal assignments — the at-risk (C, 0.72) class beats the locked-in (A, 0.94) class", () => {
    expect(beats(mk({ canvasId: 1, weight: 0.5, courseGrade: 0.72, dueInDays: 3 }), mk({ canvasId: 2, weight: 0.5, courseGrade: 0.94, dueInDays: 3 }))).toBe(true);
  });
  it("Q21: leverage beats a 2× weight gap — 50% C-class > 100% A-class", () => {
    expect(beats(mk({ canvasId: 1, weight: 0.5, courseGrade: 0.72, dueInDays: 3 }), mk({ canvasId: 2, weight: 1.0, courseGrade: 0.94, dueInDays: 3 }))).toBe(true);
  });
  it("Q18: study where improvement is biggest — a shaky class (0.5) over one you're acing (0.9), equal exam weight", () => {
    expect(beats(study({ canvasId: 1, weight: 0.25, courseGrade: 0.5, dueInDays: 3 }), study({ canvasId: 2, weight: 0.25, courseGrade: 0.9, dueInDays: 3 }))).toBe(true);
  });
});

describe("overdue is marginal, not auto-top (Q9 + Scenario A/e)", () => {
  it("Q9: a recoverable overdue item is caught up before a bigger upcoming one (same class)", () => {
    const overdue = mk({ canvasId: 1, weight: 20, dueInDays: -2, latePolicy: PERDAY10 });
    const upcoming = mk({ canvasId: 2, weight: 100, dueInDays: 3 });
    expect(beats(overdue, upcoming)).toBe(true);
  });
  it("a truly no-late-credit overdue item is dead → dropped to zero value", () => {
    expect(val(mk({ canvasId: 1, weight: 100, dueInDays: -1, latePolicy: NONE }))).toBe(0);
  });
});

describe("late policy shifts urgency (Q11, Scenario B)", () => {
  it("a forgiving (−10%/day) deadline is far less urgent than a no-credit one, same item", () => {
    const noCredit = mk({ canvasId: 1, weight: 80, dueInDays: 1, latePolicy: NONE });
    const forgiving = mk({ canvasId: 2, weight: 80, dueInDays: 1, latePolicy: PERDAY10 });
    expect(beats(noCredit, forgiving)).toBe(true);
    // Scenario B refinement: removing late credit must REVIVE the deferred essay.
    expect(val(noCredit)).toBeGreaterThan(val(forgiving) * 3);
  });
});

// --- End-to-end scenarios (the validated gut-checks; weights are illustrative) ---
describe("Scenario A — typical Tuesday (validated relations)", () => {
  // Bio C(0.72) / Calc B(0.85) / History A(0.94)
  const items: MarginalInput[] = [
    mk({ canvasId: 1, name: "a Bio discussion", weight: 0.02, courseGrade: 0.72, dueInDays: 1, effortHours: 0.25 }),
    mk({ canvasId: 2, name: "b Calc problem set", weight: 0.06, courseGrade: 0.85, dueInDays: 1, effortHours: 1.5 }),
    study({ canvasId: 3, name: "c Bio midterm study", weight: 0.25, courseGrade: 0.72, dueInDays: 3, effortHours: 3 }),
    mk({ canvasId: 4, name: "d History essay", weight: 0.3, courseGrade: 0.94, dueInDays: 4, effortHours: 5 }),
    mk({ canvasId: 5, name: "e History overdue quiz", weight: 0.05, courseGrade: 0.94, dueInDays: -2, effortHours: 0.5, latePolicy: PERDAY10 }),
    study({ canvasId: 6, name: "f Calc quiz study", weight: 0.05, courseGrade: 0.85, dueInDays: 2, effortHours: 1 }),
    mk({ canvasId: 7, name: "g Bio lab", weight: 0.15, courseGrade: 0.72, dueInDays: 5, effortHours: 3 }),
    mk({ canvasId: 8, name: "h History undated discussion", weight: 0.03, courseGrade: 0.94, dueInDays: null, effortHours: 0.25 }),
  ];
  const order = rankItems(items).map((r) => r.canvasId);
  const rankOf = (id: number) => order.indexOf(id);

  it("the undated item (h) is dead last", () => {
    expect(order[order.length - 1]).toBe(8);
  });
  it("far high-leverage (g, Bio lab) outranks the sooner low-weight quiz study (f) — validated", () => {
    expect(rankOf(7)).toBeLessThan(rankOf(6));
  });
  it("the trivial, forgiving, locked-A overdue quiz (e) is NOT in the top 3", () => {
    expect(rankOf(5)).toBeGreaterThanOrEqual(3);
  });
  it("leverage neutralizes the 2×+ points gap: C-class midterm study (c) and the bigger A-class essay (d) are the same order of magnitude", () => {
    const c = items.find((i) => i.canvasId === 3)!;
    const d = items.find((i) => i.canvasId === 4)!;
    const ratio = val(c) / val(d);
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
  });
});

describe("dated-first rule (Calvin, from real-data review): undated work is always backfill", () => {
  it("a dated item outranks an undated one even when the undated has more marginal value", () => {
    const undatedBig = mk({ canvasId: 1, name: "undated participation", weight: 0.5, dueInDays: null });
    const datedSmall = mk({ canvasId: 2, name: "dated small", weight: 0.05, dueInDays: 20 });
    expect(val(undatedBig)).toBeGreaterThan(val(datedSmall)); // raw value: the undated one is "worth" more…
    expect(rankItems([undatedBig, datedSmall]).map((r) => r.canvasId)).toEqual([2, 1]); // …but dated ranks first
  });
  it("undated items still order among themselves by value", () => {
    const big = mk({ canvasId: 1, name: "u-big", weight: 0.3, dueInDays: null });
    const small = mk({ canvasId: 2, name: "u-small", weight: 0.05, dueInDays: null });
    expect(rankItems([small, big]).map((r) => r.canvasId)).toEqual([1, 2]);
  });
});
