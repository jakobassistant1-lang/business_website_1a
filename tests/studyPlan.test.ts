// Acceptance suite for the v1 scheduler's pure core (docs/navo-scheduling-v1-spec.md §11).
import { describe, it, expect } from "vitest";
import {
  inflate,
  assessmentTier,
  effectiveWindow,
  sessionCount,
  bellWeights,
  expandAssessment,
  chunkDeliverable,
  MAX_BLOCK,
  INFLATION,
  LEAD_CAP,
} from "@/lib/studyPlan";

describe("budgeting + tiers", () => {
  it("inflates estimates ×1.2", () => {
    expect(inflate(5)).toBeCloseTo(6, 6);
    expect(INFLATION).toBe(1.2);
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
    expect(sessionCount(inflate(4), "final", 14)).toBe(6); // 4.8h → 6 sessions
  });
  it("caps at 2 sessions/day across the window", () => {
    expect(sessionCount(inflate(20), "exam", 2)).toBe(4); // window of 2 days → ≤4 sessions
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

describe("expandAssessment — the sample midterm (7 days out, ~4h study)", () => {
  const plan = expandAssessment({ daysUntil: 7, studyHours: 4, tier: "final" });
  it("produces 6 spaced sessions across the 7-day window", () => {
    expect(plan.sessions).toHaveLength(6);
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
  it("the placed hours ≈ the inflated study estimate, with no overflow", () => {
    const placed = plan.sessions.reduce((s, x) => s + x.hours, 0);
    expect(Math.abs(placed - inflate(4))).toBeLessThan(0.35); // ~4.8h, allowing per-session rounding drift
    expect(plan.overflowHours).toBeLessThan(0.2);
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
    const plan = expandAssessment({ daysUntil: 14, studyHours: 10, tier: "final" }); // 12h over 14 days
    expect(plan.sessions.length).toBeLessThanOrEqual(12);
    plan.sessions.forEach((s) => expect(s.hours).toBeLessThanOrEqual(MAX_BLOCK + 1e-9));
    expect(plan.overflowHours).toBeLessThan(0.5);
  });
  it("a huge load in a tiny window surfaces overflow (can't fit), still ≤1h each", () => {
    const plan = expandAssessment({ daysUntil: 2, studyHours: 10, tier: "exam" }); // 12h, 2-day window
    plan.sessions.forEach((s) => expect(s.hours).toBeLessThanOrEqual(MAX_BLOCK + 1e-9));
    expect(plan.overflowHours).toBeGreaterThan(1); // genuinely over capacity
    expect(plan.sessions.filter((s) => s.dayOffset === 1).length).toBeGreaterThan(1); // doubled up on a day
  });
});

describe("chunkDeliverable", () => {
  it("≤1h work (after inflation) stays one block", () => {
    const blocks = chunkDeliverable({ effortHours: 0.75 }); // ×1.2 = 0.9h
    expect(blocks).toHaveLength(1);
    expect(blocks[0].hours).toBeLessThanOrEqual(MAX_BLOCK + 1e-9);
  });
  it("splits >1h work into ≤1h blocks", () => {
    const blocks = chunkDeliverable({ effortHours: 2 }); // ×1.2 = 2.4h → 3 blocks
    expect(blocks).toHaveLength(3);
    blocks.forEach((b) => expect(b.hours).toBeLessThanOrEqual(MAX_BLOCK + 1e-9));
    expect(blocks.reduce((s, b) => s + b.hours, 0)).toBeCloseTo(2.4, 1);
  });
});
