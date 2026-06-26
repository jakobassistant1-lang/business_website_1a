import { describe, it, expect } from "vitest";
import { deriveCourseGrade, gradeBand } from "@/lib/courseGrade";

describe("deriveCourseGrade", () => {
  it("shows the real Canvas number when there is one", () => {
    expect(deriveCourseGrade(88, "B+", true)).toEqual({ state: "graded", score: 88, letter: "B+" });
  });

  it("rounds the score to one decimal", () => {
    expect(deriveCourseGrade(91.666, "A-", true).score).toBe(91.7);
  });

  it("keeps a real 0% as a graded score (not 'no grades')", () => {
    expect(deriveCourseGrade(0, "F", true).state).toBe("graded");
  });

  it("treats a blank letter as null, not an empty string", () => {
    expect(deriveCourseGrade(75, "  ", true).letter).toBeNull();
  });

  it("reports HIDDEN when the total is null but graded work exists — no guesswork", () => {
    expect(deriveCourseGrade(null, null, true)).toEqual({ state: "hidden", score: null, letter: null });
  });

  it("reports NONE when the total is null and nothing is graded yet", () => {
    expect(deriveCourseGrade(null, null, false)).toEqual({ state: "none", score: null, letter: null });
  });

  it("never invents an estimate: a hidden course carries no score or letter", () => {
    const g = deriveCourseGrade(undefined, "A", true);
    expect(g.score).toBeNull();
    expect(g.letter).toBeNull();
  });
});

describe("gradeBand", () => {
  it("bands by score at the 90/80/70 thresholds", () => {
    expect(gradeBand(95)).toBe("high");
    expect(gradeBand(90)).toBe("high");
    expect(gradeBand(89.9)).toBe("good");
    expect(gradeBand(80)).toBe("good");
    expect(gradeBand(72)).toBe("fair");
    expect(gradeBand(69)).toBe("low");
  });
});
