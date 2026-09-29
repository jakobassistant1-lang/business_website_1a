import { prisma } from "./prisma";
import { getSetting, ANALYSIS_PROMPT_KEY } from "./settings";
import { studentZone } from "./studentZone";
import { isAssignmentDone } from "./assignmentStatus";
import { itemType } from "./itemType";
import {
  analyzeAssignments,
  selectUnanalyzed,
  analysisInputHash,
  hasHedge,
  hedgedSummary,
  DEFAULT_ANALYSIS_INSTRUCTION,
  MAX_BATCH,
  type AnalyzableRow,
} from "./analysis";

/**
 * Analyze a user's un-analyzed assignments in one batched Gemini call and write
 * the results (effort + bucket + summary) back to the rows. Fails OPEN: on no
 * key / error nothing is written, rows stay on the flat-effort fallback. Steady
 * state (everything analyzed) makes ZERO Gemini calls — the content hash check
 * short-circuits before the network (the `todo.length === 0` early return below).
 *
 * `remaining` (#129) is how many of this user's rows STILL need analysis after
 * this batch, by the same `needsAnalysis` predicate that selected the work — one
 * call only ever clears MAX_BATCH of them, so the client drains in bounded rounds
 * until `done`. Rows the model didn't answer for stay counted (they are still
 * un-analyzed), so the count never lies about the backlog.
 */
export async function runAnalysis(
  userId: number,
): Promise<{ analyzed: number; skipped: number; ok: boolean; remaining: number; done: boolean }> {
  const rows = await prisma.assignment.findMany({
    where: { userId },
    include: { course: true, user: { select: { timeZone: true } } },
  });
  // THE date zone: the student's Canvas profile zone (every row carries the same user).
  const zone = studentZone(rows[0]?.user);
  const now = new Date();

  const analyzable: AnalyzableRow[] = rows.map((r) => ({
    canvasId: r.canvasId,
    name: r.name,
    courseName: r.course.name,
    pointsPossible: r.pointsPossible,
    dueAt: r.dueAt ? r.dueAt.toISOString() : null,
    description: r.description,
    analyzedAt: r.analyzedAt,
    analysisHash: r.analysisHash,
    aiSummary: r.aiSummary ?? null,
    active: !isAssignmentDone(
      { manualDoneAt: r.manualDoneAt ?? null, submittedAt: r.submittedAt ?? null, submissionState: r.submissionState ?? null },
      { type: itemType(r.submissionType, r.name), dueAt: r.dueAt ?? null, zone, now },
    ),
  }));
  // #145 targeted re-run: rows whose content is already analyzed and only their
  // stored summary hedges get ONLY a new summary — effort/importance stay put.
  const summaryOnly = new Set(
    analyzable
      .filter((r) => r.analyzedAt !== null && r.analysisHash === analysisInputHash(r) && hedgedSummary(r))
      .map((r) => r.canvasId),
  );

  const pending = selectUnanalyzed(analyzable);
  const todo = pending.slice(0, MAX_BATCH);
  // Nothing to do → answer the cheap, truthful "done" without touching Gemini.
  if (todo.length === 0) return { analyzed: 0, skipped: rows.length, ok: true, remaining: 0, done: true };

  const instruction = (await getSetting(ANALYSIS_PROMPT_KEY)) || DEFAULT_ANALYSIS_INSTRUCTION;
  const res = await analyzeAssignments(todo, instruction, zone);
  // AI unavailable → nothing written; the backlog is unchanged and the client's
  // `analyzed === 0` check ends the drain (fail open, no retry storm).
  if (!res.ok) return { analyzed: 0, skipped: rows.length, ok: false, remaining: pending.length, done: false };

  const inputById = new Map(todo.map((t) => [t.canvasId, t]));
  let analyzed = 0;
  for (const item of res.items) {
    const input = inputById.get(item.canvasId);
    if (!input) continue;
    // A hedged summary is never stored (#145): it is cleared instead, so the
    // targeted re-run can't loop and the page falls back to the describe route.
    const summary = item.summary == null ? undefined : hasHedge(item.summary) ? null : item.summary;
    try {
      if (summaryOnly.has(item.canvasId)) {
        await prisma.assignment.update({
          where: { userId_canvasId: { userId, canvasId: item.canvasId } },
          data: { aiSummary: summary ?? null, analyzedAt: new Date() },
        });
        analyzed++;
        continue;
      }
      await prisma.assignment.update({
        where: { userId_canvasId: { userId, canvasId: item.canvasId } },
        data: {
          // undefined = "leave unchanged" (don't clobber effort with a summary-only result).
          estimatedEffortHours: item.estimatedEffortHours ?? undefined,
          effortBucket: item.bucket ?? undefined,
          aiImportance: item.importance ?? undefined,
          aiSummary: summary,
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
  const remaining = Math.max(0, pending.length - analyzed);
  return { analyzed, skipped: rows.length - analyzed, ok: true, remaining, done: remaining === 0 };
}
