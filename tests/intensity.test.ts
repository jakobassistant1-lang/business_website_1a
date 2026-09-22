// Week-intensity rating (#62 regression): the dashboard rated a week "Easy" while
// showing 16 overdue assignments, because only work due inside the planning window
// reached the rating. Overdue work is part of the load, and Gemini's overlay is
// clamped so it can't talk the rating back down below the overdue floor.
import { describe, it, expect } from "vitest";
import { deterministicIntensity, intensityFloor, overdueLoad, resolveIntensity, type WeekLoad } from "@/lib/intensity";

/** A genuinely quiet week: nothing due, nothing planned, no overdue. */
const CALM: WeekLoad = {
  dueThisWeek: 0,
  examQuiz: 0,
  workHours: 0,
  budgetHours: 14,
  overloadHours: 0,
  overdueCount: 0,
  overdueHours: 0,
};
const week = (over: Partial<WeekLoad>): WeekLoad => ({ ...CALM, ...over });

describe("deterministicIntensity — overdue work counts toward the week", () => {
  it("16 overdue assignments can never read 'Easy' (the #62 bug)", () => {
    expect(deterministicIntensity(week({ overdueCount: 16 }))).toBe("hard");
    // …not even when literally nothing else is on the calendar.
    expect(deterministicIntensity(week({ overdueCount: 16, overdueHours: 0, budgetHours: 0 }))).toBe("hard");
  });

  it("≥8 overdue items or ≥10 overdue hours is 'hard' regardless", () => {
    expect(deterministicIntensity(week({ overdueCount: 8 }))).toBe("hard");
    expect(deterministicIntensity(week({ overdueCount: 1, overdueHours: 10 }))).toBe("hard");
    expect(deterministicIntensity(week({ overdueCount: 7, overdueHours: 9.9 }))).toBe("moderate");
  });

  it("3 overdue items over an otherwise light week floors at 'moderate'", () => {
    expect(deterministicIntensity(week({ overdueCount: 3 }))).toBe("moderate");
    expect(deterministicIntensity(week({ overdueCount: 1, overdueHours: 4 }))).toBe("moderate");
    // …and 2 small overdue items don't move a truly quiet week.
    expect(deterministicIntensity(week({ overdueCount: 2, overdueHours: 1.5 }))).toBe("easy");
  });

  it("overdue hours join the planned work when measuring against the budget", () => {
    // 4h planned of a 14h budget = 0.29 → easy on its own; +7h catch-up = 0.79 → moderate.
    expect(deterministicIntensity(week({ workHours: 4 }))).toBe("easy");
    expect(deterministicIntensity(week({ workHours: 4, overdueCount: 2, overdueHours: 7 }))).toBe("moderate");
  });

  it("with 0 overdue the original thresholds are unchanged", () => {
    expect(deterministicIntensity(CALM)).toBe("easy");
    expect(deterministicIntensity(week({ dueThisWeek: 3, workHours: 4 }))).toBe("easy");
    expect(deterministicIntensity(week({ dueThisWeek: 4 }))).toBe("moderate");
    expect(deterministicIntensity(week({ examQuiz: 1 }))).toBe("moderate");
    expect(deterministicIntensity(week({ workHours: 7 }))).toBe("moderate"); // load 0.5
    expect(deterministicIntensity(week({ examQuiz: 2 }))).toBe("hard");
    expect(deterministicIntensity(week({ overloadHours: 1 }))).toBe("hard");
    expect(deterministicIntensity(week({ workHours: 12 }))).toBe("hard"); // load 0.86
  });
});

describe("resolveIntensity — the Gemini overlay is clamped, never trusted downward", () => {
  it("'easy' from the AI over 16 overdue assignments is clamped to 'hard'", () => {
    expect(resolveIntensity("easy", week({ overdueCount: 16 }))).toBe("hard");
    expect(resolveIntensity("moderate", week({ overdueCount: 16 }))).toBe("hard");
  });

  it("'easy' over a 3-overdue week is clamped to 'moderate'", () => {
    expect(resolveIntensity("easy", week({ overdueCount: 3 }))).toBe("moderate");
  });

  it("the AI may still raise the rating, and rules a clean week freely", () => {
    expect(resolveIntensity("hard", CALM)).toBe("hard");
    expect(resolveIntensity("easy", week({ dueThisWeek: 4 }))).toBe("easy"); // no overdue ⇒ no floor
  });

  it("no verdict falls back to the deterministic rating", () => {
    expect(resolveIntensity(null, week({ overdueCount: 16 }))).toBe("hard");
    expect(resolveIntensity(undefined, CALM)).toBe("easy");
  });
});

describe("overdueLoad — built from the same items the dashboard lists", () => {
  const items = [
    { status: "overdue", estimatedEffortHours: 2, effortOverrideHours: null },
    { status: "overdue", estimatedEffortHours: 1.5, effortOverrideHours: 3 }, // override wins
    { status: "overdue", estimatedEffortHours: null, effortOverrideHours: null }, // counts, 0h
    { status: "normal", estimatedEffortHours: 9, effortOverrideHours: null },
    { status: "done", estimatedEffortHours: 9, effortOverrideHours: null },
  ];

  it("counts only overdue rows and sums their effective effort", () => {
    expect(overdueLoad(items)).toEqual({ overdueCount: 3, overdueHours: 5 });
    expect(overdueLoad([])).toEqual({ overdueCount: 0, overdueHours: 0 });
  });

  it("feeds the rule directly", () => {
    expect(intensityFloor(overdueLoad(items))).toBe("moderate");
    expect(deterministicIntensity({ ...CALM, ...overdueLoad(items) })).toBe("moderate");
  });
});
