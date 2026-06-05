import { prisma } from "./prisma";
import { generatePlan, Plan, SchedulerAssignment } from "./scheduler";
import { rankRecommendations, priorityInputsFromPlan, type ScoredAssignment } from "./priority";

export interface SubmittedItem {
  canvasId: number;
  name: string;
  courseName: string;
  submittedAt: string; // ISO — present because submittedAt is non-null
  submissionScore: number | null;
  pointsPossible: number | null;
  htmlUrl: string | null;
}

export interface PlanPayload {
  connected: boolean;
  accountName: string | null;
  syncedAt: string | null;
  validationStatus: string | null;
  stale: boolean; // cache shown but last validation/sync is not "valid"
  hours: number;
  windowDays: number;
  plan: Plan;
  submitted: SubmittedItem[]; // assignments already turned in — excluded from the plan
  recommendations: ScoredAssignment[]; // top deterministic priorities (AI narrates these separately)
}

/**
 * Loads the cached assignments and runs the rule-based planner. `hoursOverride`
 * lets the Plan view regenerate with a different daily budget (FR-8) without
 * persisting it.
 *
 * Assignments with a non-null `submittedAt` are separated out: they are
 * removed from the scheduler input (no need to plan work that is done) and
 * surfaced in `payload.submitted` so the UI can show a "Completed" section.
 */
export async function loadPlan(userId: number, hoursOverride?: number): Promise<PlanPayload> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const cred = await prisma.canvasCredential.findUnique({ where: { userId } });
  const rows = await prisma.assignment.findMany({
    where: { userId },
    include: { course: true },
  });

  const hours =
    hoursOverride !== undefined && Number.isFinite(hoursOverride)
      ? hoursOverride
      : user.defaultHoursPerDay;

  // Split submitted vs. active assignments (canvas-mcp integration).
  // "Done" = has a submission timestamp AND Canvas hasn't reset it. When an
  // instructor reopens a submission, Canvas keeps the old submitted_at but flips
  // workflow_state to "unsubmitted"; such rows must stay in the plan, not vanish.
  const isDone = (a: (typeof rows)[number]) =>
    a.submittedAt !== null && a.submissionState !== "unsubmitted";
  const submittedRows = rows.filter(isDone);
  const activeRows = rows.filter((a) => !isDone(a));

  const submitted: SubmittedItem[] = submittedRows.map((a) => ({
    canvasId: a.canvasId,
    name: a.name,
    courseName: a.course.name,
    submittedAt: a.submittedAt!.toISOString(),
    submissionScore: a.submissionScore,
    pointsPossible: a.pointsPossible,
    htmlUrl: a.htmlUrl,
  }));

  const assignments: SchedulerAssignment[] = activeRows.map((a) => ({
    canvasId: a.canvasId,
    name: a.name,
    courseName: a.course.name,
    dueAt: a.dueAt,
    pointsPossible: a.pointsPossible,
    htmlUrl: a.htmlUrl,
  }));

  const plan = generatePlan(assignments, hours, user.planningWindowDays, user.defaultEffortHours);

  // Deterministic prioritization (pure logic). pointsById is threaded in because
  // the scheduler drops pointsPossible from its output.
  const submittedIds = new Set(submittedRows.map((a) => a.canvasId));
  const pointsById = new Map<number, number | null>(activeRows.map((a) => [a.canvasId, a.pointsPossible]));
  const recommendations = rankRecommendations(priorityInputsFromPlan(plan, submittedIds, pointsById), {
    windowDays: user.planningWindowDays,
    effortHours: user.defaultEffortHours,
  }).top;

  const status = cred?.lastValidationStatus ?? null;
  const stale = !!cred && status !== null && status !== "valid";

  return {
    connected: !!cred,
    accountName: cred?.accountName ?? null,
    syncedAt: cred?.syncedAt ? cred.syncedAt.toISOString() : null,
    validationStatus: status,
    stale,
    hours,
    windowDays: user.planningWindowDays,
    plan,
    submitted,
    recommendations,
  };
}
