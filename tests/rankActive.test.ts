import { describe, it, expect } from "vitest";
import { rankActiveRows, courseTotalPoints, type RankableRow } from "@/lib/rankActive";

const NOW = new Date(2026, 5, 1, 9, 0, 0); // Mon Jun 1 2026

function row(o: Partial<RankableRow> & { canvasId: number }): RankableRow {
  return {
    name: `A${o.canvasId}`, courseName: "C", courseCanvasId: 1, dueAt: new Date(2026, 5, 4),
    pointsPossible: 10, htmlUrl: null, submissionType: "none", estimatedEffortHours: null, ...o,
  };
}
const survivors = (rows: RankableRow[]) => {
  const totals = courseTotalPoints(rows.map((r) => ({ courseCanvasId: r.courseCanvasId, pointsPossible: r.pointsPossible })));
  return new Set(rankActiveRows(rows, totals, 2, NOW).map((r) => r.canvasId));
};

describe("rankActiveRows — AI actionable screen + guardrails", () => {
  it("drops a passive non-assessment the AI flagged false (no online submission)", () => {
    expect(survivors([row({ canvasId: 1, name: "Class Participation", type: "other", requiresAction: false })]).has(1)).toBe(false);
  });
  it("NEVER drops an assessment, even if the AI flags it false (a no-submission exam looks like a placeholder)", () => {
    expect(survivors([row({ canvasId: 1, name: "Exam 1", type: "exam", requiresAction: false })]).has(1)).toBe(true);
    expect(survivors([row({ canvasId: 2, name: "Quiz 2", type: "quiz", requiresAction: false })]).has(2)).toBe(true);
  });
  it("NEVER drops an item with an online submission, even if flagged false", () => {
    expect(survivors([row({ canvasId: 1, type: "other", submissionType: "discussion_topic", requiresAction: false })]).has(1)).toBe(true);
  });
  it("keeps items the AI did not flag (requiresAction null or true)", () => {
    const out = survivors([row({ canvasId: 1, requiresAction: null }), row({ canvasId: 2, requiresAction: true })]);
    expect(out.has(1)).toBe(true);
    expect(out.has(2)).toBe(true);
  });
});
