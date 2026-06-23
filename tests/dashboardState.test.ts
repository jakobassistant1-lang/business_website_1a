import { describe, it, expect } from "vitest";
import { classifyDataShape } from "@/lib/onboardingState";
import type { CalendarData, CalendarItem } from "@/lib/calendarData";
import type { ScoredAssignment } from "@/lib/priority";
import type { AtRiskItem } from "@/lib/scheduler";

// "Today" is a local-day string, matching how DashboardView computes it.
const TODAY = "2026-06-23";
// A due date `offset` days from TODAY (local midnight + 17:00), as an ISO string.
function iso(offsetDays: number): string {
  return new Date(2026, 5, 23 + offsetDays, 17, 0, 0).toISOString();
}

function item(over: Partial<CalendarItem> & { canvasId: number }): CalendarItem {
  return {
    name: `Item ${over.canvasId}`,
    courseName: "Course",
    dueAt: iso(2),
    type: "assignment",
    status: "normal",
    studyLeadDays: null,
    pointsPossible: 10,
    estimatedEffortHours: null,
    effortBucket: null,
    summary: null,
    htmlUrl: null,
    ...over,
  };
}

const rec = (canvasId: number): ScoredAssignment =>
  ({ canvasId, name: `Item ${canvasId}`, courseName: "Course", htmlUrl: null, score: 50, reason: "" } as unknown as ScoredAssignment);
const risk = (canvasId: number): AtRiskItem =>
  ({ canvasId, name: `Item ${canvasId}`, courseName: "Course", dueAt: iso(-2), kind: "overdue", shortfallHours: 0, htmlUrl: null } as AtRiskItem);

// Only the four fields the classifier reads matter; the rest are inert stubs.
function data(over: Partial<CalendarData>): CalendarData {
  return {
    items: [],
    completed: [],
    recommendations: [],
    atRisk: [],
    ...over,
  } as unknown as CalendarData;
}

describe("classifyDataShape", () => {
  it("empty: no active items and no completed items", () => {
    expect(classifyDataShape(data({}), TODAY)).toBe("empty");
  });

  it("not empty when only completed work exists (all-done account is normal, not empty)", () => {
    const d = data({ completed: [item({ canvasId: 1, status: "done", dueAt: iso(-1) })] });
    expect(classifyDataShape(d, TODAY)).toBe("normal");
  });

  it("all-undated: there are items and every one has dueAt == null", () => {
    const d = data({ items: [item({ canvasId: 1, dueAt: null }), item({ canvasId: 2, dueAt: null })] });
    expect(classifyDataShape(d, TODAY)).toBe("all-undated");
  });

  it("not all-undated when at least one item is dated", () => {
    const d = data({
      items: [item({ canvasId: 1, dueAt: null }), item({ canvasId: 2, dueAt: iso(3) })],
      recommendations: [rec(2)],
    });
    expect(classifyDataShape(d, TODAY)).not.toBe("all-undated");
  });

  it("all-overdue: no forward recommendations but overdue items exist", () => {
    const d = data({
      items: [item({ canvasId: 1, dueAt: iso(-2), status: "overdue" })],
      recommendations: [],
      atRisk: [risk(1)],
    });
    expect(classifyDataShape(d, TODAY)).toBe("all-overdue");
  });

  it("all-due-later: dated items, none due today, none overdue", () => {
    const d = data({
      items: [item({ canvasId: 1, dueAt: iso(2) }), item({ canvasId: 2, dueAt: iso(4) })],
      recommendations: [rec(1), rec(2)],
      atRisk: [],
    });
    expect(classifyDataShape(d, TODAY)).toBe("all-due-later");
  });

  it("normal: an item is due today", () => {
    const d = data({
      items: [item({ canvasId: 1, dueAt: iso(0) }), item({ canvasId: 2, dueAt: iso(3) })],
      recommendations: [rec(1), rec(2)],
    });
    expect(classifyDataShape(d, TODAY)).toBe("normal");
  });

  it("normal: a normal mix (due today + overdue) is not a thin state", () => {
    const d = data({
      items: [item({ canvasId: 1, dueAt: iso(0) }), item({ canvasId: 2, dueAt: iso(-2), status: "overdue" })],
      recommendations: [rec(1)],
      atRisk: [risk(2)],
    });
    expect(classifyDataShape(d, TODAY)).toBe("normal");
  });

  it("a future-due item that is also overdue-laden stays out of all-due-later (atRisk guard)", () => {
    // Dated, none due today, BUT an overdue item exists → this is the normal
    // catch-up dashboard (Focus shows the future item, rail shows overdue),
    // not the calm 'you're ahead' state.
    const d = data({
      items: [item({ canvasId: 1, dueAt: iso(3) }), item({ canvasId: 2, dueAt: iso(-1), status: "overdue" })],
      recommendations: [rec(1)],
      atRisk: [risk(2)],
    });
    expect(classifyDataShape(d, TODAY)).toBe("normal");
  });

  it("precedence: empty wins over everything (no items, no completed)", () => {
    expect(classifyDataShape(data({ recommendations: [], atRisk: [] }), TODAY)).toBe("empty");
  });

  it("precedence: all-undated wins over all-overdue when items are undated but overdue exists", () => {
    // An all-null item set can still have an overdue atRisk entry; the undated
    // shape is more specific, so it should win.
    const d = data({
      items: [item({ canvasId: 1, dueAt: null })],
      recommendations: [],
      atRisk: [risk(1)],
    });
    expect(classifyDataShape(d, TODAY)).toBe("all-undated");
  });

  it("is deterministic for identical inputs", () => {
    const d = data({ items: [item({ canvasId: 1, dueAt: iso(2) })], recommendations: [rec(1)] });
    expect(classifyDataShape(d, TODAY)).toBe(classifyDataShape(d, TODAY));
  });
});
