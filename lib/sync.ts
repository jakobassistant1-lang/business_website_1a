import { prisma } from "./prisma";
import {
  validateCredentials,
  fetchCourses,
  fetchAssignments,
  fetchAnnouncements,
  fetchAssignmentGroups,
  fetchSyllabus,
  courseGradeFromEnrollment,
  CanvasError,
  type CanvasAssignment,
  type CanvasAssignmentGroup,
} from "./canvas";
import { computeGradeWeights } from "./gradeWeight";
import { analyzeLatePolicies, type LatePolicyInput } from "./latePolicy";
import { CanvasStatus, messageFor } from "./messages";
import { decryptSecret } from "./crypto";
import type { SyncMode } from "./syncPolicy";

// The policy lives in lib/syncPolicy (pure, browser-safe); re-exported so the
// existing `@/lib/sync` import paths keep working.
export { syncDecision, parseTrigger, MOUNT_FRESH_MS, type SyncMode, type SyncTrigger } from "./syncPolicy";

/** Parse a Canvas date string, guarding against malformed values that would
 *  otherwise produce an Invalid Date (which Prisma rejects at write time). */
function toDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface SyncResult {
  ok: boolean;
  status: CanvasStatus;
  message: string;
  syncedAt: string | null; // last successful FULL sync (may be the pre-existing one on failure)
  failedCourses: string[]; // partial-failure warning (FR-7.2)
  mode?: SyncMode; // which sync ran (absent when nothing ran)
  skipped?: "fresh" | "in_flight" | "timeout"; // set by the route when it answered without a fresh run
}

/** Quick mode only refreshes courses with work due inside this window (or undated). */
export const QUICK_LIVE_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * The submission-bearing assignment fields — everything a quick sync may write.
 * Shared with the full sync (which layers the grade-group fields on top) so the
 * two modes can't drift on how a Canvas assignment maps to a row. Deliberately
 * excludes gradeWeight/groupId/groupName/groupWeight (full-sync only) and never
 * touches manualDoneAt/effort/AI fields (never written by sync at all).
 */
export function quickAssignmentData(a: CanvasAssignment, ctx: { userId: number; courseId: number; courseCanvasId: number }) {
  return {
    userId: ctx.userId,
    courseId: ctx.courseId,
    courseCanvasId: ctx.courseCanvasId,
    name: a.name ?? `Assignment ${a.id}`,
    dueAt: toDate(a.due_at),
    pointsPossible: a.points_possible ?? null,
    htmlUrl: a.html_url ?? null,
    submissionType: Array.isArray(a.submission_types) ? a.submission_types.join(",") : null,
    description: a.description ?? null,
    // Submission data from include[]=submission (canvas-mcp integration).
    submittedAt: toDate(a.submission?.submitted_at),
    submissionScore: a.submission?.score ?? null,
    submissionState: a.submission?.workflow_state ?? null,
  };
}

/**
 * Cache-on-demand sync (FR-6). On any validation/abort failure the existing
 * cache is preserved (FR-7) — we never delete cached coursework on error.
 */
export async function runSync(userId: number, opts?: { mode?: SyncMode }): Promise<SyncResult> {
  const mode: SyncMode = opts?.mode ?? "full";
  const cred = await prisma.canvasCredential.findUnique({ where: { userId } });
  if (!cred) {
    return { ok: false, status: "error", message: "No Canvas connection saved.", syncedAt: null, failedCourses: [] };
  }
  // Decrypt the token for use (backward compatible: legacy plaintext tokens,
  // stored before encryption, pass through decryptSecret unchanged).
  const token = decryptSecret(cred.token);
  const prevSyncedAt = cred.syncedAt ? cred.syncedAt.toISOString() : null;

  // 1. Validate (FR-6.1). On failure: abort, keep cache (FR-7.1).
  const v = await validateCredentials(cred.host, token);
  await prisma.canvasCredential.update({
    where: { userId },
    data: {
      lastValidationStatus: v.status,
      ...(v.status === "valid" ? { lastValidatedAt: new Date() } : {}),
      ...(v.accountName ? { accountName: v.accountName } : {}),
    },
  });
  if (v.status !== "valid") {
    return { ok: false, status: v.status, message: messageFor(v.status, v.httpCode), syncedAt: prevSyncedAt, failedCourses: [], mode };
  }

  if (mode === "quick") return runQuickSync(userId, cred.host, token, prevSyncedAt);

  // 2. Fetch active courses. A failure here (incl. 403 insufficient_scope) aborts; cache kept.
  let courses;
  try {
    courses = await fetchCourses(cred.host, token);
  } catch (e) {
    const status: CanvasStatus = e instanceof CanvasError ? e.status : "error";
    await prisma.canvasCredential.update({ where: { userId }, data: { lastValidationStatus: status } });
    return { ok: false, status, message: messageFor(status), syncedAt: prevSyncedAt, failedCourses: [], mode };
  }

  // 3. Per-course: upsert course, then assignments + announcements.
  //    A single course failing is a partial failure (FR-7.2): keep its cached
  //    rows, warn, continue.
  const failedCourses: string[] = [];
  let credentialError: CanvasStatus | null = null; // token-level problem (FR-5) seen on a data call
  let lastCourseError: CanvasStatus | null = null; // representative status if courses fail
  const syllabiToParse: LatePolicyInput[] = []; // collected across courses → one batched late-policy read
  const courseDbIdByCanvasId = new Map<number, number>(); // map late-policy results back to course rows
  for (const c of courses) {
    const courseName = c.name ?? `Course ${c.id}`;
    // The student's own course total (include[]=total_scores). Null is preserved
    // verbatim — the loader decides "hidden" vs "no grades yet" from the work.
    const grade = courseGradeFromEnrollment(c);
    const course = await prisma.course.upsert({
      where: { userId_canvasId: { userId, canvasId: c.id } },
      create: { canvasId: c.id, userId, name: courseName, currentScore: grade.score, currentGrade: grade.grade },
      update: { name: courseName, currentScore: grade.score, currentGrade: grade.grade },
    });
    courseDbIdByCanvasId.set(c.id, course.id);

    try {
      // assignment_groups + syllabus fail OPEN (a missing group/syllabus must not
      // fail the whole course); they enrich the prioritizer + the grade calculator.
      const [assignments, announcements, groups, syllabus] = await Promise.all([
        fetchAssignments(cred.host, token, c.id),
        fetchAnnouncements(cred.host, token, c.id),
        fetchAssignmentGroups(cred.host, token, c.id).catch(() => [] as CanvasAssignmentGroup[]),
        fetchSyllabus(cred.host, token, c.id).catch(() => null),
      ]);
      const groupById = new Map(groups.map((g) => [g.id, g] as const));

      if (syllabus) syllabiToParse.push({ courseId: c.id, courseName, syllabus });
      const weightById = new Map(
        computeGradeWeights(
          groups.map((g) => ({
            id: g.id,
            groupWeight: g.group_weight,
            assignments: (g.assignments ?? []).map((a) => ({ canvasId: a.id, pointsPossible: a.points_possible })),
          })),
        ).map((w) => [w.canvasId, w.gradeWeight]),
      );

      for (const a of assignments) {
        const group = a.assignment_group_id != null ? groupById.get(a.assignment_group_id) : undefined;
        const data = {
          ...quickAssignmentData(a, { userId, courseId: course.id, courseCanvasId: c.id }),
          // Share of the course grade (weighted-group courses); null → caller uses
          // points / course-total (lib/gradeWeight).
          gradeWeight: weightById.get(a.id) ?? null,
          // Raw assignment group + weight → the weighted grade calculator.
          groupId: a.assignment_group_id ?? null,
          groupName: group?.name ?? null,
          groupWeight: group?.group_weight ?? null,
        };
        await prisma.assignment.upsert({
          where: { userId_canvasId: { userId, canvasId: a.id } },
          create: { canvasId: a.id, ...data },
          update: data,
        });
      }

      for (const an of announcements) {
        const data = {
          userId,
          courseId: course.id,
          courseCanvasId: c.id,
          title: an.title ?? `Announcement ${an.id}`,
          message: an.message ?? null,
          postedAt: toDate(an.posted_at),
          htmlUrl: an.html_url ?? null,
        };
        await prisma.announcement.upsert({
          where: { userId_canvasId: { userId, canvasId: an.id } },
          create: { canvasId: an.id, ...data },
          update: data,
        });
      }
    } catch (e) {
      failedCourses.push(c.name ?? `Course ${c.id}`);
      const status: CanvasStatus = e instanceof CanvasError ? e.status : "error";
      lastCourseError = status;
      // A 401/403 on a data call is a token problem, not a one-off course glitch (FR-5).
      if (status === "invalid_token" || status === "insufficient_scope") credentialError = status;
    }
  }

  // Late policy: ONE batched Gemini read over the collected syllabi (fail-open —
  // no key / error leaves each course at the no-credit default). Best-effort: a
  // failure here never fails the sync.
  if (syllabiToParse.length > 0) {
    try {
      const lp = await analyzeLatePolicies(syllabiToParse);
      if (lp.ok) {
        for (const r of lp.items) {
          const courseDbId = courseDbIdByCanvasId.get(r.courseId);
          if (courseDbId == null) continue;
          await prisma.course
            .update({ where: { id: courseDbId }, data: { latePolicyKind: r.policy.kind, latePolicyValue: r.policy.value } })
            .catch(() => {});
        }
      }
    } catch {
      /* late policy is best-effort; ignore */
    }
  }

  // 4a. Token-level failure on data calls: surface the specific FR-5 message and
  //     keep the cache stale (don't advance the sync time). Cache is preserved.
  if (credentialError) {
    await prisma.canvasCredential.update({ where: { userId }, data: { lastValidationStatus: credentialError } });
    return { ok: false, status: credentialError, message: messageFor(credentialError), syncedAt: prevSyncedAt, failedCourses, mode };
  }

  // 4b. Every course failed (e.g., all unreachable): don't claim success or
  //     advance the sync time; mark stale and show cached data (FR-7).
  if (courses.length > 0 && failedCourses.length === courses.length) {
    const status = lastCourseError ?? "error";
    await prisma.canvasCredential.update({ where: { userId }, data: { lastValidationStatus: status } });
    return { ok: false, status, message: "Couldn't refresh any courses right now. Showing cached data.", syncedAt: prevSyncedAt, failedCourses, mode };
  }

  // 4c. Mark sync time (FR-6.1). Full or partial success; stale label clears.
  const syncedAt = new Date();
  await prisma.canvasCredential.update({ where: { userId }, data: { syncedAt } });

  const message =
    failedCourses.length > 0
      ? `Synced with warnings: couldn't refresh ${failedCourses.length} course(s). Cached data kept.`
      : "Sync complete.";
  return { ok: true, status: "valid", message, syncedAt: syncedAt.toISOString(), failedCourses, mode };
}

/**
 * QUICK sync — the "did anything get submitted?" refresh. Credentials were just
 * validated by runSync (same DB status writes as full). Uses the Course rows we
 * already have (no /courses call; excluded courses skipped) and fetches ONLY
 * assignments (+ submissions) per course; no announcements, groups, syllabus or
 * late-policy read. Writes only the quickAssignmentData fields — a brand-new
 * assignment gets its group/weight fields on the next full sync.
 *
 * Same partial-failure handling as full (FR-7.2) and the same token-level
 * semantics (FR-5). Never advances CanvasCredential.syncedAt: that timestamp
 * means "last FULL sync" so the mount rule (syncDecision) keeps working.
 */
async function runQuickSync(userId: number, host: string, token: string, prevSyncedAt: string | null): Promise<SyncResult> {
  const mode: SyncMode = "quick";
  // Only courses with live-looking work: a full sync never prunes Course rows,
  // so a course Canvas no longer returns would otherwise fail (401/403) on
  // every tab return and warn forever. "Live" = at least one assignment due in
  // the last 60 days or later, or undated.
  const sixtyDaysAgo = new Date(Date.now() - QUICK_LIVE_WINDOW_MS);
  const courses = await prisma.course.findMany({
    where: {
      userId,
      excludedAt: null,
      assignments: { some: { OR: [{ dueAt: { gte: sixtyDaysAgo } }, { dueAt: null }] } },
    },
    select: { id: true, canvasId: true, name: true },
  });
  if (courses.length === 0) {
    // Nothing cached yet (focus fired before the first full sync) — nothing to do.
    return { ok: true, status: "valid", message: "Nothing to refresh yet.", syncedAt: prevSyncedAt, failedCourses: [], mode };
  }

  // Courses fetch in parallel (≤ ~10 per student); each course's rows are then
  // written in order so a failure stays scoped to that course.
  const settled = await Promise.allSettled(courses.map((course) => fetchAssignments(host, token, course.canvasId)));

  const failedCourses: string[] = [];
  let lastCourseError: CanvasStatus | null = null;
  for (let i = 0; i < courses.length; i++) {
    const course = courses[i];
    const r = settled[i];
    let failure: unknown = r.status === "rejected" ? r.reason : null;
    if (r.status === "fulfilled") {
      try {
        for (const a of r.value) {
          const data = quickAssignmentData(a, { userId, courseId: course.id, courseCanvasId: course.canvasId });
          await prisma.assignment.upsert({
            where: { userId_canvasId: { userId, canvasId: a.id } },
            create: { canvasId: a.id, ...data },
            update: data,
          });
        }
      } catch (e) {
        failure = e;
      }
    }
    if (failure === null) continue;
    failedCourses.push(course.name);
    const status: CanvasStatus = failure instanceof CanvasError ? failure.status : "error";
    // UNLIKE full mode, a 401/403 here is NOT treated as a token problem: quick
    // walks our cached Course rows, so a concluded/dropped course answers
    // 401/403 with a perfectly good token (validated at step 1 moments ago).
    // Quick mode therefore NEVER writes a token-level status; the next full
    // sync (which walks live /courses) is the only judge of the token.
    if (status !== "invalid_token" && status !== "insufficient_scope") lastCourseError = status;
  }

  if (failedCourses.length === courses.length) {
    // Every course failed: report stale, keep the cache (FR-7), write nothing —
    // step 1 already recorded the token as valid and quick mode may not overrule it.
    const status: CanvasStatus = lastCourseError ?? "unreachable";
    return { ok: false, status, message: "Couldn't refresh any courses right now. Showing cached data.", syncedAt: prevSyncedAt, failedCourses, mode };
  }

  const message =
    failedCourses.length > 0
      ? `Synced with warnings: couldn't refresh ${failedCourses.length} course(s). Cached data kept.`
      : "Refreshed submissions.";
  return { ok: true, status: "valid", message, syncedAt: prevSyncedAt, failedCourses, mode };
}
