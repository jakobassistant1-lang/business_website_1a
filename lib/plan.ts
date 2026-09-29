import { prisma } from "./prisma";
import { assignmentDoneReason, type DoneReason } from "./assignmentStatus";
import { itemType } from "./itemType";
import { generatePlan, Plan, SchedulerAssignment } from "./scheduler";
import { rankRecommendations, priorityInputsFromPlan, type ScoredAssignment } from "./priority";
import { effortOrDefault } from "./effort";
import { studentZone } from "./studentZone";

export interface SubmittedItem {
  canvasId: number;
  name: string;
  courseName: string;
  submittedAt: string | null; // ISO; null for a done item with no submission time (graded in class, test date passed, checked off)
  doneReason: DoneReason;
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
 * LEGACY (retired PlanView): still reachable via /api/plan and /api/briefing, so it
 * follows the same effort + day rules as lib/calendarData.
 *
 * Loads the cached assignments and runs the rule-based planner. `hoursOverride`
 * lets the Plan view regenerate with a different daily budget (FR-8) without
 * persisting it.
 *
 * Assignments with a non-null `submittedAt` are separated out: they are
 * removed from the scheduler input (no need to plan work that is done) and
 * surfaced in `payload.submitted` so the UI can show a "Completed" section.
 */
export async function loadPlan(userId: number, hoursOverride?: number): Promise<PlanPayload> {
  const [user, cred, rows] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.canvasCredential.findUnique({ where: { userId } }),
    prisma.assignment.findMany({ where: { userId, course: { excludedAt: null } }, include: { course: true } }),
  ]);

  const hours =
    hoursOverride !== undefined && Number.isFinite(hoursOverride)
      ? hoursOverride
      : user.defaultHoursPerDay;

  // Split done vs. active with THE done rule (lib/assignmentStatus), given its ctx so
  // a past exam/quiz date counts too — days read in the student's zone.
  const zone = studentZone(user);
  const now = new Date();
  const doneReason = (a: (typeof rows)[number]) =>
    assignmentDoneReason(a, { type: itemType(a.submissionType, a.name), dueAt: a.dueAt, zone, now });
  const submittedRows = rows.filter((a) => doneReason(a) !== null);
  const activeRows = rows.filter((a) => doneReason(a) === null);

  const submitted: SubmittedItem[] = submittedRows.map((a) => ({
    canvasId: a.canvasId,
    name: a.name,
    courseName: a.course.name,
    submittedAt: a.submittedAt ? a.submittedAt.toISOString() : null, // may be null for a done item
    doneReason: doneReason(a)!,
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
    // THE effort rule (lib/effort): override as typed, else the padded AI estimate,
    // else the user's default — the same number the live plan and tags use (#136).
    estimatedEffortHours: effortOrDefault(a, user.defaultEffortHours),
    summary: a.aiSummary ?? null,
  }));

  const plan = generatePlan(assignments, hours, user.planningWindowDays, user.defaultEffortHours, now, zone);

  // Deterministic prioritization (pure logic). pointsById is threaded in because
  // the scheduler drops pointsPossible from its output.
  const submittedIds = new Set(submittedRows.map((a) => a.canvasId));
  const pointsById = new Map<number, number | null>(activeRows.map((a) => [a.canvasId, a.pointsPossible]));
  const recommendations = rankRecommendations(priorityInputsFromPlan(plan, submittedIds, pointsById), {
    windowDays: user.planningWindowDays,
    effortHours: user.defaultEffortHours,
    now,
    zone, // days + date words in the student's zone (lib/studentZone), like the live ranking
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
