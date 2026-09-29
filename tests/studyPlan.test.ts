// Acceptance suite for the v1 scheduler's pure core (docs/navo-scheduling-v1-spec.md §11).
import { describe, it, expect } from "vitest";
import {
  assessmentTier,
  effectiveWindow,
  sessionCount,
  bellWeights,
  expandAssessment,
  chunkDeliverable,
  MAX_BLOCK,
  MIN_BLOCK,
  LEAD_CAP,
} from "@/lib/studyPlan";
import * as studyPlan from "@/lib/studyPlan";

const sum = (xs: { hours: number }[]) => Math.round(xs.reduce((s, x) => s + x.hours * 100, 0)) / 100;

describe("budgeting + tiers", () => {
  it("never pads again — hours arrive already padded by lib/effort (#136)", () => {
    expect("inflate" in studyPlan).toBe(false);
    expect("INFLATION" in studyPlan).toBe(false);
    expect(sum(chunkDeliverable({ effortHours: 5 }))).toBe(5);
    expect(sum(expandAssessment({ daysUntil: 7, studyHours: 4, tier: "final" }).sessions)).toBe(4);
  });
  it("classifies the study tier (final > exam > quiz)", () => {
    expect(assessmentTier("quiz", "Week 3 Quiz")).toBe("quiz");
    expect(assessmentTier("exam", "Final Exam")).toBe("final");
    expect(assessmentTier("exam", "Midterm 2")).toBe("final");
    expect(assessmentTier("exam", "Cumulative test")).toBe("final");
    expect(assessmentTier("exam", "Unit 4 Exam")).toBe("exam");
  });
  it("caps the lead window by tier and by how far out it is", () => {
    expect(effectiveWindow(30, "final")).toBe(14); // capped
    expect(effectiveWindow(5, "final")).toBe(5); // sooner than the cap
    expect(effectiveWindow(30, "exam")).toBe(7);
    expect(effectiveWindow(30, "quiz")).toBe(3);
    expect(LEAD_CAP).toEqual({ quiz: 3, exam: 7, final: 14 });
  });
});

describe("sessionCount", () => {
  it("honors the per-type minimum", () => {
    expect(sessionCount(0.5, "final", 14)).toBe(4); // tiny load still ≥4 for a final
    expect(sessionCount(0.5, "exam", 7)).toBe(3);
    expect(sessionCount(0.5, "quiz", 3)).toBe(2);
  });
  it("scales up with study hours (~0.85h each)", () => {
    expect(sessionCount(4.8, "final", 14)).toBe(6); // 4.8h → 6 sessions
  });
  it("caps at 2 sessions/day across the window", () => {
    expect(sessionCount(24, "exam", 2)).toBe(4); // window of 2 days → ≤4 sessions
  });
});

describe("bellWeights", () => {
  it("sums to 1, peaks in the middle, light at both ends, lightest last", () => {
    const w = bellWeights(5);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(w[2]).toBeGreaterThan(w[0]); // middle > first
    expect(w[2]).toBeGreaterThan(w[4]); // middle > last
    expect(w[4]).toBeLessThan(w[0]); // day-before is the lightest
    expect(Math.min(...w)).toBeGreaterThan(0);
  });
});

describe("expandAssessment — the sample midterm (7 days out, 4h AI estimate → 4.4h padded once)", () => {
  const plan = expandAssessment({ daysUntil: 7, studyHours: 4.4, tier: "final" });
  it("produces 5 spaced sessions across the 7-day window (4.4h ÷ ~0.85h)", () => {
    expect(plan.sessions).toHaveLength(5);
    expect(plan.window).toBe(7);
    const offs = plan.sessions.map((s) => s.dayOffset);
    expect(offs[0]).toBe(7); // session 1 is earliest
    expect(offs[offs.length - 1]).toBe(1); // last is the day before
    for (let i = 1; i < offs.length; i++) expect(offs[i]).toBeLessThanOrEqual(offs[i - 1]); // monotonic
  });
  it("every session is ≤ 1 hour", () => {
    for (const s of plan.sessions) expect(s.hours).toBeLessThanOrEqual(MAX_BLOCK + 1e-9);
  });
  it("session 1 is a review, the rest are relearn", () => {
    expect(plan.sessions[0].kind).toBe("review");
    expect(plan.sessions.slice(1).every((s) => s.kind === "relearn")).toBe(true);
  });
  it("is bell-shaped: the day-before is lighter than the middle", () => {
    const last = plan.sessions[plan.sessions.length - 1].hours;
    const mid = plan.sessions[2].hours;
    expect(last).toBeLessThan(mid);
  });
  it("the placed hours equal the study estimate exactly, with no overflow", () => {
    expect(sum(plan.sessions)).toBe(4.4); // hundredths, no rounding drift
    expect(plan.overflowHours).toBe(0);
  });
});

describe("expandAssessment — a quiz (3 days out, 1.5h)", () => {
  const plan = expandAssessment({ daysUntil: 3, studyHours: 1.5, tier: "quiz" });
  it("is two sessions: review then relearn, ≤1h, on day −3 and −1", () => {
    expect(plan.sessions).toHaveLength(2);
    expect(plan.sessions.map((s) => s.kind)).toEqual(["review", "relearn"]);
    expect(plan.sessions.map((s) => s.dayOffset)).toEqual([3, 1]);
    plan.sessions.forEach((s) => expect(s.hours).toBeLessThanOrEqual(MAX_BLOCK + 1e-9));
  });
});

describe("expandAssessment — heavy & over-capacity loads", () => {
  it("a heavy final spreads into many ≤1h sessions (capped), no overflow when it fits", () => {
    const plan = expandAssessment({ daysUntil: 14, studyHours: 10, tier: "final" }); // 10h over 14 days
    expect(plan.sessions.length).toBeLessThanOrEqual(12);
    plan.sessions.forEach((s) => expect(s.hours).toBeLessThanOrEqual(MAX_BLOCK + 1e-9));
    expect(plan.overflowHours).toBeLessThan(0.5);
  });
  it("a huge load in a tiny window surfaces overflow (can't fit), still ≤1h each", () => {
    const plan = expandAssessment({ daysUntil: 2, studyHours: 10, tier: "exam" }); // 10h, 2-day window
    plan.sessions.forEach((s) => expect(s.hours).toBeLessThanOrEqual(MAX_BLOCK + 1e-9));
    expect(plan.overflowHours).toBeGreaterThan(1); // genuinely over capacity
    expect(Math.round((sum(plan.sessions) + plan.overflowHours) * 100) / 100).toBe(10); // placed + overflow = the whole load
    expect(plan.sessions.filter((s) => s.dayOffset === 1).length).toBeGreaterThan(1); // doubled up on a day
  });
});

describe("chunkDeliverable", () => {
  it("≤1h work stays one block, at exactly its hours", () => {
    const blocks = chunkDeliverable({ effortHours: 0.9 });
    expect(blocks).toHaveLength(1);
    expect(blocks[0].hours).toBe(0.9);
  });
  it("splits >1h work into ≤1h blocks that sum exactly to the effort", () => {
    const blocks = chunkDeliverable({ effortHours: 2.4 }); // → 3 blocks
    expect(blocks).toHaveLength(3);
    blocks.forEach((b) => expect(b.hours).toBeLessThanOrEqual(MAX_BLOCK + 1e-9));
    expect(sum(blocks)).toBe(2.4);
    expect(sum(chunkDeliverable({ effortHours: 4.95 }))).toBe(4.95); // 5 × 0.99, not 5 × 1.0
    expect(sum(chunkDeliverable({ effortHours: 2.2 }))).toBe(2.2); // uneven split keeps the total
  });
  it("~0 effort (under the 3-minute MIN_BLOCK) is no block, never a 0m one", () => {
    expect(chunkDeliverable({ effortHours: 0 })).toEqual([]);
    expect(chunkDeliverable({ effortHours: MIN_BLOCK - 0.01 })).toEqual([]);
    expect(chunkDeliverable({ effortHours: MIN_BLOCK })).toHaveLength(1);
  });
});

describe("expandAssessment — tiny loads never produce a sub-MIN_BLOCK (\"0m\") session", () => {
  for (const h of [0.05, 0.08, 0.12, 0.3]) {
    it(`${h}h`, () => {
      const plan = expandAssessment({ daysUntil: 7, studyHours: h, tier: "final" });
      plan.sessions.forEach((s) => expect(s.hours).toBeGreaterThanOrEqual(MIN_BLOCK));
      expect(sum(plan.sessions)).toBe(h); // folded, not dropped
      expect(plan.sessions[0].kind).toBe("review");
    });
  }
  it("0h → no sessions, no overflow", () => {
    expect(expandAssessment({ daysUntil: 3, studyHours: 0, tier: "quiz" })).toMatchObject({ sessions: [], overflowHours: 0 });
  });
});
