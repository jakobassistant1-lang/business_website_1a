import { prisma } from "./prisma";
import { getSetting, ANALYSIS_PROMPT_KEY } from "./settings";
import {
  analyzeAssignments,
  selectUnanalyzed,
  analysisInputHash,
  DEFAULT_ANALYSIS_INSTRUCTION,
  MAX_BATCH,
  type AnalyzableRow,
} from "./analysis";

/**
 * Analyze a user's un-analyzed assignments in one batched Gemini call and write
 * the results (effort + bucket + summary) back to the rows. Fails OPEN: on no
 * key / error nothing is written, rows stay on the flat-effort fallback. Steady
 * state (everything analyzed) makes ZERO Gemini calls — the content hash check
 * short-circuits before the network.
 */
export async function runAnalysis(userId: number): Promise<{ analyzed: number; skipped: number; ok: boolean }> {
  const rows = await prisma.assignment.findMany({ where: { userId }, include: { course: true } });

  const analyzable: AnalyzableRow[] = rows.map((r) => ({
    canvasId: r.canvasId,
    name: r.name,
    courseName: r.course.name,
    pointsPossible: r.pointsPossible,
    dueAt: r.dueAt ? r.dueAt.toISOString() : null,
    description: r.description,
    analyzedAt: r.analyzedAt,
    analysisHash: r.analysisHash,
  }));

  const todo = selectUnanalyzed(analyzable).slice(0, MAX_BATCH);
  if (todo.length === 0) return { analyzed: 0, skipped: rows.length, ok: true };

  const instruction = (await getSetting(ANALYSIS_PROMPT_KEY)) || DEFAULT_ANALYSIS_INSTRUCTION;
  const res = await analyzeAssignments(todo, instruction);
  if (!res.ok) return { analyzed: 0, skipped: rows.length, ok: false };

  const inputById = new Map(todo.map((t) => [t.canvasId, t]));
  let analyzed = 0;
  for (const item of res.items) {
    const input = inputById.get(item.canvasId);
    if (!input) continue;
    try {
      await prisma.assignment.update({
        where: { userId_canvasId: { userId, canvasId: item.canvasId } },
        data: {
          // undefined = "leave unchanged" (don't clobber effort with a summary-only result).
          estimatedEffortHours: item.estimatedEffortHours ?? undefined,
          effortBucket: item.bucket ?? undefined,
          aiImportance: item.importance ?? undefined,
          aiSummary: item.summary ?? undefined,
          // false (passive grade) must persist; only null means "leave unchanged".
          aiRequiresAction: item.requiresAction ?? undefined,
          analysisHash: analysisInputHash(input),
          analyzedAt: new Date(),
        },
      });
      analyzed++;
    } catch {
      /* skip a bad row, keep the batch going */
    }
  }
  return { analyzed, skipped: rows.length - analyzed, ok: true };
}
