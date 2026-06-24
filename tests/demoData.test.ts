import { describe, it, expect } from "vitest";
import { buildDemoCalendarData } from "@/lib/demoData";

// Fixed "now" → deterministic assertions.
const NOW = new Date("2026-06-15T08:00:00.000Z");

describe("buildDemoCalendarData", () => {
  const { data, todayYmd } = buildDemoCalendarData(NOW);

  it("returns a connected, fully-populated CalendarData", () => {
    expect(data.connected).toBe(true);
    expect(data.validationStatus).toBe("valid");
    expect(typeof data.overloadHours).toBe("number");
    expect(data.items.length).toBeGreaterThanOrEqual(10);
    expect(data.completed.length).toBeGreaterThanOrEqual(1);
    expect(todayYmd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("covers exactly the four demo subjects", () => {
    const subjects = new Set(data.items.map((i) => i.courseName.split(" · ")[0]));
    expect(subjects).toEqual(new Set(["Science", "Math", "History", "English"]));
  });

  it("produces a real 7-day plan with study blocks", () => {
    expect(data.plan.days).toHaveLength(7);
    const hasStudyBlock = data.plan.days.some((d) => d.blocks.some((b) => b.study));
    expect(hasStudyBlock).toBe(true);
  });

  it("ranks work and surfaces a forward-looking recommendation + an overdue item", () => {
    expect(data.ranked.length).toBeGreaterThan(0);
    expect(data.recommendations.length).toBeGreaterThan(0);
    expect(data.recommendations.length).toBeLessThanOrEqual(3);
    // Biology "Lab Report 2" is due in the past → overdue, in atRisk only (not recommendations).
    expect(data.atRisk.length).toBeGreaterThanOrEqual(1);
    expect(data.atRisk.every((r) => r.kind === "overdue")).toBe(true);
    const overdueIds = new Set(data.atRisk.map((r) => r.canvasId));
    expect(data.recommendations.every((r) => !overdueIds.has(r.canvasId))).toBe(true);
  });

  it("orders the demo do-next list by the value-first prioritizer (same as live, not a demo-only deadline sort)", () => {
    // The demo runs through rankActiveRows (marginal value), exactly like live data,
    // so `ranked` is non-increasing by score and recommendations are the top
    // non-overdue items in that same order — NOT a separate deadline sort.
    const scores = data.ranked.map((r) => r.score);
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    const overdueIds = new Set(data.atRisk.map((r) => r.canvasId));
    const topNonOverdue = data.ranked.filter((r) => !overdueIds.has(r.canvasId)).slice(0, data.recommendations.length);
    expect(data.recommendations.map((r) => r.canvasId)).toEqual(topNonOverdue.map((r) => r.canvasId));
  });

  it("gives every item the fields the views read", () => {
    for (const it of [...data.items, ...data.completed]) {
      expect(it.canvasId).toBeTypeOf("number");
      expect(it.name).toBeTruthy();
      expect(["assignment", "quiz", "exam", "other"]).toContain(it.type);
      expect(["normal", "overdue", "done"]).toContain(it.status);
    }
  });
});
