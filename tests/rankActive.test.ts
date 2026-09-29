import { describe, it, expect } from "vitest";
import { rankActiveRows, courseTotalPoints, type RankableRow } from "@/lib/rankActive";

const NOW = new Date(2026, 5, 1, 9, 0, 0); // Mon Jun 1 2026

function row(o: Partial<RankableRow> & { canvasId: number }): RankableRow {
  return {
    name: `A${o.canvasId}`, courseName: "C", courseCanvasId: 1, dueAt: new Date(2026, 5, 4),
    pointsPossible: 10, htmlUrl: null, submissionType: "none", estimatedEffortHours: null, ...o,
  };
}
const rank = (rows: RankableRow[]) => {
  const totals = courseTotalPoints(rows.map((r) => ({ courseCanvasId: r.courseCanvasId, pointsPossible: r.pointsPossible })));
  return rankActiveRows(rows, totals, 2, NOW);
};
/** Items ranked with importance > 0 (passive items are listed, but at 0). */
const survivors = (rows: RankableRow[]) => new Set(rank(rows).filter((r) => (r.value ?? 0) > 0).map((r) => r.canvasId));

describe("rankActiveRows — AI actionable screen + guardrails", () => {
  it("a passive non-assessment the AI flagged false (no online submission) stays LISTED at importance 0 (owner 2026-09-28)", () => {
    const rows = [row({ canvasId: 1, name: "Class Participation", type: "other", requiresAction: false })];
    expect(survivors(rows).has(1)).toBe(false);
    const [r] = rank(rows);
    expect(r.canvasId).toBe(1);
    expect(r.passive).toBe(true);
    expect(r.value).toBe(0);
    expect(r.reason).toBe("Graded by your teacher");
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
