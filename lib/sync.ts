import { prisma } from "./prisma";
import {
  validateCredentials,
  fetchCourses,
  fetchAssignments,
  fetchAnnouncements,
  courseGradeFromEnrollment,
  CanvasError,
} from "./canvas";
import { CanvasStatus, messageFor } from "./messages";
import { decryptSecret } from "./crypto";

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
  syncedAt: string | null; // last successful sync (may be the pre-existing one on failure)
  failedCourses: string[]; // partial-failure warning (FR-7.2)
}

/**
 * Cache-on-demand sync (FR-6). On any validation/abort failure the existing
 * cache is preserved (FR-7) — we never delete cached coursework on error.
 */
export async function runSync(userId: number): Promise<SyncResult> {
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
    return { ok: false, status: v.status, message: messageFor(v.status, v.httpCode), syncedAt: prevSyncedAt, failedCourses: [] };
  }

  // 2. Fetch active courses. A failure here (incl. 403 insufficient_scope) aborts; cache kept.
  let courses;
  try {
    courses = await fetchCourses(cred.host, token);
  } catch (e) {
    const status: CanvasStatus = e instanceof CanvasError ? e.status : "error";
    await prisma.canvasCredential.update({ where: { userId }, data: { lastValidationStatus: status } });
    return { ok: false, status, message: messageFor(status), syncedAt: prevSyncedAt, failedCourses: [] };
  }

  // 3. Per-course: upsert course, then assignments + announcements.
  //    A single course failing is a partial failure (FR-7.2): keep its cached
  //    rows, warn, continue.
  const failedCourses: string[] = [];
  let credentialError: CanvasStatus | null = null; // token-level problem (FR-5) seen on a data call
  let lastCourseError: CanvasStatus | null = null; // representative status if courses fail
  for (const c of courses) {
    // The student's own course total (include[]=total_scores). Null is preserved
    // verbatim — the loader decides "hidden" vs "no grades yet" from the work.
    const grade = courseGradeFromEnrollment(c);
    const course = await prisma.course.upsert({
      where: { userId_canvasId: { userId, canvasId: c.id } },
      create: { canvasId: c.id, userId, name: c.name ?? `Course ${c.id}`, currentScore: grade.score, currentGrade: grade.grade },
      update: { name: c.name ?? `Course ${c.id}`, currentScore: grade.score, currentGrade: grade.grade },
    });

    try {
      const [assignments, announcements] = await Promise.all([
        fetchAssignments(cred.host, token, c.id),
        fetchAnnouncements(cred.host, token, c.id),
      ]);

      for (const a of assignments) {
        const data = {
          userId,
          courseId: course.id,
          courseCanvasId: c.id,
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

  // 4a. Token-level failure on data calls: surface the specific FR-5 message and
  //     keep the cache stale (don't advance the sync time). Cache is preserved.
  if (credentialError) {
    await prisma.canvasCredential.update({ where: { userId }, data: { lastValidationStatus: credentialError } });
    return { ok: false, status: credentialError, message: messageFor(credentialError), syncedAt: prevSyncedAt, failedCourses };
  }

  // 4b. Every course failed (e.g., all unreachable): don't claim success or
  //     advance the sync time; mark stale and show cached data (FR-7).
  if (courses.length > 0 && failedCourses.length === courses.length) {
    const status = lastCourseError ?? "error";
    await prisma.canvasCredential.update({ where: { userId }, data: { lastValidationStatus: status } });
    return { ok: false, status, message: "Couldn't refresh any courses right now. Showing cached data.", syncedAt: prevSyncedAt, failedCourses };
  }

  // 4c. Mark sync time (FR-6.1). Full or partial success; stale label clears.
  const syncedAt = new Date();
  await prisma.canvasCredential.update({ where: { userId }, data: { syncedAt } });

  const message =
    failedCourses.length > 0
      ? `Synced with warnings: couldn't refresh ${failedCourses.length} course(s). Cached data kept.`
      : "Sync complete.";
  return { ok: true, status: "valid", message, syncedAt: syncedAt.toISOString(), failedCourses };
}
