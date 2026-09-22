// Canvas sync hardening for "stranger" schools (#123): a rate-limit 403 is a
// THROTTLE (retried, never a token flag), genuine 403s still mean a scope
// problem, retries are bounded, teacher/TA courses are excluded without touching
// the cache, and a big account degrades gracefully inside a soft time budget.
// Global fetch is stubbed (routed by URL) so the retry code under test is real.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    canvasCredential: { findUnique: vi.fn(), update: vi.fn() },
    course: { findMany: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    assignment: { upsert: vi.fn() },
    announcement: { upsert: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  CanvasError,
  CANVAS_RETRY,
  fetchAssignments,
  fetchCourses,
  filterStudentCourses,
  isThrottleResponse,
  validateCredentials,
  type CanvasCourse,
} from "@/lib/canvas";
import { runSync, QUICK_CONCURRENCY } from "@/lib/sync";
import { MOUNT_FRESH_MS } from "@/lib/syncPolicy";
import { messageFor } from "@/lib/messages";

type Fn = ReturnType<typeof vi.fn>;
const credFind = prisma.canvasCredential.findUnique as unknown as Fn;
const credUpdate = prisma.canvasCredential.update as unknown as Fn;
const courseFindMany = prisma.course.findMany as unknown as Fn;
const courseUpsert = prisma.course.upsert as unknown as Fn;
const assignmentUpsert = prisma.assignment.upsert as unknown as Fn;

// --- response builders ---------------------------------------------------------
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const throttle403 = (headers: Record<string, string> = {}) => new Response("403 Forbidden (Rate Limit Exceeded)", { status: 403, headers });
const genuine403 = () => json({ status: "unauthorized", errors: [{ message: "user not authorized to perform that action" }] }, 403, { "x-rate-limit-remaining": "699.5" });

/** A fetch stub that answers by URL; `handlers` are tried in order, first match wins. */
function routeFetch(handlers: Array<[RegExp, () => Response | Promise<Response>]>) {
  const fn = vi.fn(async (input: unknown) => {
    const url = String(input);
    for (const [re, h] of handlers) if (re.test(url)) return h();
    return json([]);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
/** Answer the same URL differently call by call, then repeat the last one. */
function sequence(...responses: Array<() => Response>) {
  let i = 0;
  return () => responses[Math.min(i++, responses.length - 1)]();
}

const ORIGINAL_RETRY = { ...CANVAS_RETRY };
beforeEach(() => {
  vi.clearAllMocks();
  // 1ms/2ms/4ms instead of 1s/2s/4s, no jitter — the schedule's SHAPE is what's under test
  Object.assign(CANVAS_RETRY, { baseMs: 1, jitterMs: 0 });
});
afterEach(() => {
  Object.assign(CANVAS_RETRY, ORIGINAL_RETRY);
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("production retry schedule (the constants a reviewer can read off)", () => {
  it("3 retries, 1s base (→ 1s/2s/4s), Retry-After capped at 8s, ≤ 10s of waiting per request", () => {
    expect(ORIGINAL_RETRY).toEqual({ attempts: 3, baseMs: 1000, jitterMs: 250, retryAfterCapMs: 8000, maxTotalWaitMs: 10_000 });
    // the full exponential schedule (+ max jitter) fits the wall budget
    expect(1000 + 2000 + 4000 + 3 * ORIGINAL_RETRY.jitterMs).toBeLessThanOrEqual(ORIGINAL_RETRY.maxTotalWaitMs);
  });
  it("CANVAS_RETRY is mutable under vitest (NODE_ENV=test) and frozen otherwise", () => {
    expect(process.env.NODE_ENV).toBe("test");
    expect(Object.isFrozen(CANVAS_RETRY)).toBe(false);
    expect(readFileSync("lib/canvas.ts", "utf8")).toMatch(/process\.env\.NODE_ENV === "test" \? \{ \.\.\.RETRY_DEFAULTS \} : Object\.freeze/);
  });
});

describe("throttle detection (a 403 that is NOT a scope problem)", () => {
  it("body 'Rate Limit Exceeded' (any case) → throttle", async () => {
    expect(await isThrottleResponse(throttle403())).toBe(true);
    expect(await isThrottleResponse(new Response("rate limit EXCEEDED", { status: 403 }))).toBe(true);
  });
  it("X-Rate-Limit-Remaining ≤ 0 → throttle, even with an unhelpful body", async () => {
    expect(await isThrottleResponse(new Response("Forbidden", { status: 403, headers: { "x-rate-limit-remaining": "0" } }))).toBe(true);
    expect(await isThrottleResponse(new Response("Forbidden", { status: 403, headers: { "x-rate-limit-remaining": "-12.5" } }))).toBe(true);
  });
  it("JSON errors[].message matching /rate limit/i → throttle", async () => {
    expect(await isThrottleResponse(json({ errors: [{ message: "Rate limit reached for this token" }] }, 403))).toBe(true);
  });
  it("429 is always a throttle; a genuine 403 (permission body, budget left) is not; other codes never are", async () => {
    expect(await isThrottleResponse(new Response("", { status: 429 }))).toBe(true);
    expect(await isThrottleResponse(genuine403())).toBe(false);
    expect(await isThrottleResponse(new Response("Rate Limit Exceeded", { status: 500 }))).toBe(false);
  });
});

describe("canvasFetch retry/backoff", () => {
  it("throttle-403 body → retried, then success (the token is never flagged)", async () => {
    const fetchMock = routeFetch([[/assignments/, sequence(throttle403, () => json([{ id: 1, name: "A1" }]))]]);
    const out = await fetchAssignments("canvas.test", "tok", 101);
    expect(out).toEqual([{ id: 1, name: "A1" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throttle-403 via X-Rate-Limit-Remaining header → retried, then success", async () => {
    const fetchMock = routeFetch([[/assignments/, sequence(() => throttle403({ "x-rate-limit-remaining": "0" }), () => json([]))]]);
    await expect(fetchAssignments("canvas.test", "tok", 101)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throttle that outlives the 3 retries → CanvasError 'throttled' (httpCode 403), 4 requests total", async () => {
    const fetchMock = routeFetch([[/assignments/, throttle403]]);
    const err = await fetchAssignments("canvas.test", "tok", 101).catch((e) => e);
    expect(err).toBeInstanceOf(CanvasError);
    expect(err.status).toBe("throttled");
    expect(err.httpCode).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1 + CANVAS_RETRY.attempts);
  });

  it("genuine 403 → insufficient_scope with NO retries", async () => {
    const fetchMock = routeFetch([[/assignments/, genuine403]]);
    const err = await fetchAssignments("canvas.test", "tok", 101).catch((e) => e);
    expect(err).toBeInstanceOf(CanvasError);
    expect(err.status).toBe("insufficient_scope");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("401 → invalid_token with NO retries", async () => {
    const fetchMock = routeFetch([[/assignments/, () => json({}, 401)]]);
    await expect(fetchAssignments("canvas.test", "tok", 101)).rejects.toMatchObject({ status: "invalid_token" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("429 → retried, then success; exhausted → 'throttled' with httpCode 429", async () => {
    let fetchMock = routeFetch([[/assignments/, sequence(() => new Response("", { status: 429 }), () => json([]))]]);
    await expect(fetchAssignments("canvas.test", "tok", 101)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock = routeFetch([[/assignments/, () => new Response("", { status: 429 })]]);
    await expect(fetchAssignments("canvas.test", "tok", 101)).rejects.toMatchObject({ status: "throttled", httpCode: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("deadline-aware: a throttle whose retry wait would end past `deadline` is NOT retried", async () => {
    Object.assign(CANVAS_RETRY, { baseMs: 1000 }); // wait would be 1s
    let fetchMock = routeFetch([[/assignments/, sequence(throttle403, () => json([]))]]);
    const err = await fetchAssignments("canvas.test", "tok", 101, Date.now() + 200).catch((e) => e);
    expect(err).toMatchObject({ status: "throttled", httpCode: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // same for a 5xx: returned as-is → "error", no sleep
    fetchMock = routeFetch([[/assignments/, () => new Response("", { status: 503 })]]);
    await expect(fetchAssignments("canvas.test", "tok", 101, Date.now() + 200)).rejects.toMatchObject({ status: "error", httpCode: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // with room left before the deadline the retry still happens
    fetchMock = routeFetch([[/assignments/, sequence(throttle403, () => json([]))]]);
    await expect(fetchAssignments("canvas.test", "tok", 101, Date.now() + 60_000)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cumulative-wait cap: after an 8s Retry-After, a second 8s retry would exceed 10s → give up", async () => {
    vi.useFakeTimers();
    Object.assign(CANVAS_RETRY, { baseMs: 1000 });
    const fetchMock = routeFetch([[/assignments/, () => throttle403({ "retry-after": "8" })]]);
    const p = fetchAssignments("canvas.test", "tok", 101).catch((e) => e);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchMock).toHaveBeenCalledTimes(2); // 8s + 8s > 10s: no third request
    expect(await p).toMatchObject({ status: "throttled" });
  });

  it("Retry-After is honored (seconds) and capped at 8s", async () => {
    vi.useFakeTimers();
    Object.assign(CANVAS_RETRY, { baseMs: 1000 }); // the default would be 1s — prove the header wins
    // Retry-After: 3 → waits 3s, not 1s
    let fetchMock = routeFetch([[/assignments/, sequence(() => new Response("", { status: 429, headers: { "retry-after": "3" } }), () => json([]))]]);
    let p = fetchAssignments("canvas.test", "tok", 101);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Retry-After: 120 → capped to 8s
    fetchMock = routeFetch([[/assignments/, sequence(() => throttle403({ "retry-after": "120" }), () => json([]))]]);
    p = fetchAssignments("canvas.test", "tok", 101);
    await vi.advanceTimersByTimeAsync(7_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("without Retry-After the waits are 1s, 2s, 4s (exponential from baseMs)", async () => {
    vi.useFakeTimers();
    Object.assign(CANVAS_RETRY, { baseMs: 1000 });
    const fetchMock = routeFetch([[/assignments/, throttle403]]);
    const p = fetchAssignments("canvas.test", "tok", 101).catch((e) => e);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(await p).toMatchObject({ status: "throttled" });
  });

  it("503 → retried then success; a 503 that outlives the retries is a plain 'error' (not a throttle)", async () => {
    let fetchMock = routeFetch([[/assignments/, sequence(() => new Response("bad gateway", { status: 503 }), () => json([]))]]);
    await expect(fetchAssignments("canvas.test", "tok", 101)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock = routeFetch([[/assignments/, () => new Response("", { status: 502 })]]);
    await expect(fetchAssignments("canvas.test", "tok", 101)).rejects.toMatchObject({ status: "error", httpCode: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("a 500 / 404 / timeout is NOT retried (only throttles and 502/503/504 are)", async () => {
    let fetchMock = routeFetch([[/assignments/, () => new Response("", { status: 500 })]]);
    await expect(fetchAssignments("canvas.test", "tok", 101)).rejects.toMatchObject({ status: "error", httpCode: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchAssignments("canvas.test", "tok", 101)).rejects.toMatchObject({ status: "unreachable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("validateCredentials on a throttled /users/self → 'throttled' (not 'error', not 'invalid_token')", async () => {
    routeFetch([[/users\/self/, throttle403]]);
    expect(await validateCredentials("canvas.test", "tok")).toEqual({ status: "throttled", httpCode: 403 });
    routeFetch([[/users\/self/, sequence(throttle403, () => json({ name: "Calvin" }))]]);
    expect(await validateCredentials("canvas.test", "tok")).toEqual({ status: "valid", accountName: "Calvin" });
  });
});

describe("enrollment filter (students only; cache never deleted)", () => {
  const student: CanvasCourse = { id: 1, name: "Micro", enrollments: [{ type: "student" }] };
  const studentRole: CanvasCourse = { id: 2, name: "Finance", enrollments: [{ type: "StudentEnrollment" }] };
  const ta: CanvasCourse = { id: 3, name: "TA'd Lab", enrollments: [{ type: "ta", role: "TaEnrollment" }] };
  const teacher: CanvasCourse = { id: 4, name: "Teaches 101", enrollments: [{ type: "teacher" }, { type: "designer" }] };
  const mixed: CanvasCourse = { id: 5, name: "Both", enrollments: [{ type: "teacher" }, { type: "student" }] };
  const noInfo: CanvasCourse = { id: 6, name: "Unknown" };
  const emptyInfo: CanvasCourse = { id: 7, name: "Empty", enrollments: [] };
  const stub = { id: 8, access_restricted_by_date: true } as unknown as CanvasCourse;

  it("fetchCourses asks Canvas for student enrollments only (enrollment_type=student)", async () => {
    const fetchMock = routeFetch([[/\/courses\?/, () => json([student])]]);
    await fetchCourses("canvas.test", "tok");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/courses?");
    expect(url).toContain("enrollment_state=active");
    expect(url).toContain("enrollment_type=student");
    expect(url).toContain("include[]=total_scores");
    expect(url).toContain("per_page=100");
  });

  it("drops TA/teacher-only courses and date-restricted stubs; keeps student, mixed, and unclassifiable courses", () => {
    const stats = { skippedNonStudent: 0, skippedRestricted: 0 };
    const kept = filterStudentCourses([student, studentRole, ta, teacher, mixed, noInfo, emptyInfo, stub], stats);
    expect(kept.map((c) => c.id)).toEqual([1, 2, 5, 6, 7]);
    expect(stats).toEqual({ skippedNonStudent: 2, skippedRestricted: 1 });
  });

  it("fetchCourses applies the filter and reports the counts through `stats`", async () => {
    routeFetch([[/\/courses\?/, () => json([student, ta, stub])]]);
    const stats = { skippedNonStudent: 0, skippedRestricted: 0 };
    const out = await fetchCourses("canvas.test", "tok", { stats });
    expect(out.map((c) => c.id)).toEqual([1]);
    expect(stats).toEqual({ skippedNonStudent: 1, skippedRestricted: 1 });
  });

  it("lib/sync never deletes Course rows (a dropped course simply stops being refreshed)", () => {
    const sync = readFileSync("lib/sync.ts", "utf8");
    expect(sync).not.toMatch(/course\.delete|deleteMany|prisma\.\$executeRaw/);
  });
});

// --- sync semantics -------------------------------------------------------------
const PREV = new Date("2026-09-15T08:00:00Z");
/** A wall clock at an exact 10-minute boundary → rotateByWindow offset 0 for any
 *  course count that divides it (we use 2 and 3). */
const T0 = MOUNT_FRESH_MS * 6;

function credentialWrites() {
  return credUpdate.mock.calls.map((c) => c[0].data);
}

describe("runSync full mode under throttling / budget", () => {
  const course = (id: number, name: string): CanvasCourse => ({ id, name, enrollments: [{ type: "student" }] });

  beforeEach(() => {
    credFind.mockResolvedValue({ userId: 1, host: "canvas.test", token: "raw-token", syncedAt: PREV });
    credUpdate.mockResolvedValue({});
    courseUpsert.mockImplementation(async ({ where }: { where: { userId_canvasId: { canvasId: number } } }) => ({ id: 1000 + where.userId_canvasId.canvasId }));
    assignmentUpsert.mockResolvedValue({});
    vi.spyOn(Date, "now").mockReturnValue(T0);
  });

  it("a throttled course (403 rate limit, retries exhausted) → per-course failure; token status stays 'valid'; syncedAt advances", async () => {
    routeFetch([
      [/users\/self/, () => json({ name: "Calvin" })],
      [/\/courses\?/, () => json([course(101, "Micro"), course(102, "Finance")])],
      [/courses\/101\/assignments/, throttle403],
      [/courses\/102\/assignments/, () => json([{ id: 7, name: "HW", due_at: null, points_possible: 1, html_url: "u", description: null }])],
    ]);
    const r = await runSync(1, { mode: "full" });
    expect(r).toMatchObject({ ok: true, status: "valid", mode: "full", failedCourses: ["Micro"] });
    expect(r.message).toBe("Synced with warnings: couldn't refresh 1 course(s). Cached data kept.");
    expect(r.syncedAt).not.toBe(PREV.toISOString());
    expect(assignmentUpsert).toHaveBeenCalledTimes(1);
    // credential writes: step-1 "valid", then syncedAt — NEVER a throttled/insufficient_scope demotion
    const writes = credentialWrites();
    expect(writes[0]).toMatchObject({ lastValidationStatus: "valid" });
    expect(writes.at(-1)).toEqual({ syncedAt: expect.any(Date) });
    for (const w of writes) expect(w.lastValidationStatus ?? "valid").toBe("valid");
  });

  it("a GENUINE 403 on a course still promotes to insufficient_scope (the reconnect banner) — unchanged", async () => {
    routeFetch([
      [/users\/self/, () => json({ name: "Calvin" })],
      [/\/courses\?/, () => json([course(101, "Micro"), course(102, "Finance")])],
      [/courses\/101\/assignments/, genuine403],
    ]);
    const r = await runSync(1, { mode: "full" });
    expect(r).toMatchObject({ ok: false, status: "insufficient_scope", failedCourses: ["Micro"] });
    expect(credentialWrites().at(-1)).toEqual({ lastValidationStatus: "insufficient_scope" });
  });

  it("EVERY course throttled → ok:false, status 'throttled' (stale, neutral), cache kept, syncedAt not advanced", async () => {
    routeFetch([
      [/users\/self/, () => json({ name: "Calvin" })],
      [/\/courses\?/, () => json([course(101, "Micro"), course(102, "Finance")])],
      [/assignments/, throttle403],
    ]);
    const r = await runSync(1, { mode: "full" });
    expect(r).toMatchObject({ ok: false, status: "throttled", failedCourses: ["Micro", "Finance"], syncedAt: PREV.toISOString() });
    expect(credentialWrites().at(-1)).toEqual({ lastValidationStatus: "throttled" });
    for (const w of credentialWrites()) expect(w).not.toHaveProperty("syncedAt");
  });

  it("/courses itself throttled → abort, lastValidationStatus 'throttled' (NOT insufficient_scope), no course writes", async () => {
    routeFetch([
      [/users\/self/, () => json({ name: "Calvin" })],
      [/\/courses\?/, throttle403],
    ]);
    const r = await runSync(1, { mode: "full" });
    expect(r).toMatchObject({ ok: false, status: "throttled", failedCourses: [], syncedAt: PREV.toISOString() });
    expect(r.message).toBe(messageFor("throttled"));
    expect(credentialWrites().at(-1)).toEqual({ lastValidationStatus: "throttled" });
    expect(courseUpsert).not.toHaveBeenCalled();
  });

  it("every per-course fetcher receives the run's deadline (startedAt + budgetMs) so retries never sleep past it", async () => {
    const seen: number[] = [];
    routeFetch([
      [/users\/self/, () => json({ name: "Calvin" })],
      [/\/courses\?/, () => json([course(101, "Micro")])],
      [/courses\/101\/assignments/, () => { seen.push(1); return throttle403(); }],
    ]);
    // Date.now is frozen at T0 → deadline = T0 + 1000; baseMs 1 → the wait fits, so retries run …
    Object.assign(CANVAS_RETRY, { baseMs: 1 });
    await runSync(1, { mode: "full", budgetMs: 1000 });
    expect(seen).toHaveLength(1 + CANVAS_RETRY.attempts);
    // … while a wait longer than the remaining budget is skipped entirely
    seen.length = 0;
    Object.assign(CANVAS_RETRY, { baseMs: 5000 });
    await runSync(1, { mode: "full", budgetMs: 1000 });
    expect(seen).toHaveLength(1);
  });

  it("late-policy Gemini read is skipped when the run is already over budget (syllabi re-parsed next full sync)", async () => {
    const latePolicy = await import("@/lib/latePolicy");
    const spy = vi.spyOn(latePolicy, "analyzeLatePolicies").mockResolvedValue({ ok: false, items: [] } as never);
    routeFetch([
      [/users\/self/, () => json({ name: "Calvin" })],
      [/\/courses\?/, () => json([course(101, "Micro")])],
      [/courses\/101\?include\[\]=syllabus_body/, () => json({ syllabus_body: "<p>Late work loses 10% per day.</p>" })],
    ]);
    const r = await runSync(1, { mode: "full", budgetMs: -1 });
    expect(r.ok).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    // positive control: inside the budget the same syllabus IS sent (proves the spy intercepts)
    await runSync(1, { mode: "full" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toEqual([{ courseId: 101, courseName: "Micro", syllabus: "<p>Late work loses 10% per day.</p>" }]);
    spy.mockRestore();
  });

  it("/users/self throttled → status 'throttled', nothing else runs (no scope/token verdict)", async () => {
    const fetchMock = routeFetch([[/users\/self/, throttle403]]);
    const r = await runSync(1, { mode: "full" });
    expect(r).toMatchObject({ ok: false, status: "throttled", mode: "full" });
    expect(credentialWrites()).toEqual([{ lastValidationStatus: "throttled" }]);
    expect(fetchMock.mock.calls.every((c) => /users\/self/.test(String(c[0])))).toBe(true);
  });

  it("budget: after the first course the rest are 'out of time' — still ok:true, syncedAt advances, cache kept", async () => {
    const fetchMock = routeFetch([
      [/users\/self/, () => json({ name: "Calvin" })],
      [/\/courses\?/, () => json([course(101, "Micro"), course(102, "Finance"), course(103, "History")])],
    ]);
    // budgetMs: -1 → "elapsed > budget" from the first check; course 0 always runs
    const r = await runSync(1, { mode: "full", budgetMs: -1 });
    expect(r).toMatchObject({ ok: true, status: "valid", failedCourses: ["Finance", "History"], outOfTime: ["Finance", "History"] });
    expect(r.message).toBe("Synced with warnings: couldn't refresh 2 course(s) (2 ran out of time). Cached data kept.");
    expect(r.syncedAt).not.toBe(PREV.toISOString());
    expect(courseUpsert).toHaveBeenCalledTimes(1);
    expect(courseUpsert.mock.calls[0][0].where).toEqual({ userId_canvasId: { userId: 1, canvasId: 101 } });
    // no data call for the courses that were cut
    expect(fetchMock.mock.calls.some((c) => /courses\/10[23]\//.test(String(c[0])))).toBe(false);
  });

  it("budget: a generous budget runs every course (out-of-time never appears)", async () => {
    routeFetch([
      [/users\/self/, () => json({ name: "Calvin" })],
      [/\/courses\?/, () => json([course(101, "Micro"), course(102, "Finance"), course(103, "History")])],
    ]);
    const r = await runSync(1, { mode: "full" }); // default 45s budget; Date.now is frozen → elapsed 0
    expect(r).toMatchObject({ ok: true, message: "Sync complete.", failedCourses: [] });
    expect(r.outOfTime).toBeUndefined();
    expect(courseUpsert).toHaveBeenCalledTimes(3);
  });

  it("budget: consecutive runs start at a different course (rotation by 10-min window) so a cut tail is reached next time", async () => {
    routeFetch([
      [/users\/self/, () => json({ name: "Calvin" })],
      [/\/courses\?/, () => json([course(101, "Micro"), course(102, "Finance"), course(103, "History")])],
    ]);
    (Date.now as unknown as Fn).mockReturnValue(T0 + MOUNT_FRESH_MS); // one window later → offset 1
    const r = await runSync(1, { mode: "full", budgetMs: -1 });
    expect(courseUpsert.mock.calls[0][0].where.userId_canvasId.canvasId).toBe(102);
    expect(r.failedCourses).toEqual(["History", "Micro"]);
  });

  it("non-student courses are skipped (count in the message), never written, never deleted", async () => {
    routeFetch([
      [/users\/self/, () => json({ name: "Calvin" })],
      [
        /\/courses\?/,
        () => json([course(101, "Micro"), { id: 201, name: "TA Lab", enrollments: [{ type: "ta" }] }, { id: 202, name: "Teaches", enrollments: [{ type: "teacher" }] }, { id: 203, access_restricted_by_date: true }]),
      ],
    ]);
    const r = await runSync(1, { mode: "full" });
    expect(r).toMatchObject({ ok: true, skippedNonStudent: 2, failedCourses: [] });
    expect(r.message).toBe("Sync complete. Skipped 2 non-student course(s).");
    expect(courseUpsert).toHaveBeenCalledTimes(1);
    expect(courseUpsert.mock.calls[0][0].where.userId_canvasId.canvasId).toBe(101);
  });
});

describe("runSync quick mode under throttling / budget", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: 11 + i, canvasId: 101 + i, name: `C${101 + i}` }));

  beforeEach(() => {
    credFind.mockResolvedValue({ userId: 1, host: "canvas.test", token: "raw-token", syncedAt: PREV });
    credUpdate.mockResolvedValue({});
    assignmentUpsert.mockResolvedValue({});
    vi.spyOn(Date, "now").mockReturnValue(T0);
  });

  it("a throttled course → per-course failure only; the ONLY credential write is step 1's 'valid'", async () => {
    courseFindMany.mockResolvedValue(rows(2));
    routeFetch([
      [/users\/self/, () => json({ name: "Calvin" })],
      [/courses\/101\/assignments/, throttle403],
      [/courses\/102\/assignments/, () => json([{ id: 9, name: "Q", due_at: null, points_possible: 1, html_url: "u", description: null }])],
    ]);
    const r = await runSync(1, { mode: "quick" });
    expect(r).toMatchObject({ ok: true, status: "valid", mode: "quick", failedCourses: ["C101"], syncedAt: PREV.toISOString() });
    expect(assignmentUpsert).toHaveBeenCalledTimes(1);
    expect(credentialWrites()).toEqual([{ lastValidationStatus: "valid", lastValidatedAt: expect.any(Date), accountName: "Calvin" }]);
  });

  it("every course throttled → ok:false, status 'throttled', still no credential write beyond step 1", async () => {
    courseFindMany.mockResolvedValue(rows(2));
    routeFetch([
      [/users\/self/, () => json({ name: "Calvin" })],
      [/assignments/, throttle403],
    ]);
    const r = await runSync(1, { mode: "quick" });
    expect(r).toMatchObject({ ok: false, status: "throttled", failedCourses: ["C101", "C102"] });
    expect(credUpdate).toHaveBeenCalledTimes(1);
  });

  it(`fans out at most ${QUICK_CONCURRENCY} course reads at a time`, async () => {
    courseFindMany.mockResolvedValue(rows(7));
    let inFlight = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    routeFetch([
      [/users\/self/, () => json({ name: "Calvin" })],
      [
        /assignments/,
        () =>
          new Promise<Response>((resolve) => {
            inFlight++;
            peak = Math.max(peak, inFlight);
            release.push(() => {
              inFlight--;
              resolve(json([]));
            });
          }),
      ],
    ]);
    const p = runSync(1, { mode: "quick" });
    await new Promise((r) => setTimeout(r, 0));
    expect(release).toHaveLength(QUICK_CONCURRENCY); // 4 started, 3 waiting
    while (release.length) release.shift()!();
    await new Promise((r) => setTimeout(r, 0));
    while (release.length) release.shift()!();
    await expect(p).resolves.toMatchObject({ ok: true, failedCourses: [] });
    expect(peak).toBe(QUICK_CONCURRENCY);
    expect(QUICK_CONCURRENCY).toBe(4);
  });

  it("budget: past the budget the remaining courses are reported 'out of time' (ok:true, syncedAt untouched)", async () => {
    courseFindMany.mockResolvedValue(rows(6));
    const fetchMock = routeFetch([[/users\/self/, () => json({ name: "Calvin" })]]);
    const r = await runSync(1, { mode: "quick", budgetMs: -1 });
    expect(r).toMatchObject({ ok: true, status: "valid", syncedAt: PREV.toISOString() });
    expect(r.failedCourses).toEqual(["C102", "C103", "C104", "C105", "C106"]);
    expect(r.outOfTime).toEqual(r.failedCourses);
    expect(r.message).toBe("Synced with warnings: couldn't refresh 5 course(s) (5 ran out of time). Cached data kept.");
    expect(fetchMock.mock.calls.filter((c) => /assignments/.test(String(c[0])))).toHaveLength(1);
    expect(credUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("wiring guards", () => {
  it("CanvasStatus has 'throttled' with the agreed copy; the route echoes it on a fresh answer", () => {
    expect(messageFor("throttled")).toBe("Canvas is busy right now (rate limit). Please try again in a minute.");
    expect(readFileSync("app/api/sync/route.ts", "utf8")).toMatch(/STATUSES[\s\S]*"throttled"/);
  });
  it("ConnectionAlert renders NOTHING for 'throttled' (transient, like unreachable); the reconnect set is unchanged", () => {
    const src = readFileSync("components/ConnectionAlert.tsx", "utf8");
    expect(src).toContain('NEEDS_RECONNECT = new Set(["invalid_token", "insufficient_scope"])');
    expect(src).not.toMatch(/status === "throttled"/);
    expect(src).not.toMatch(/toneSoft|messageFor/);
  });
  it("the Connections pill AND the connect-result line for 'throttled' are neutral, and the copy never claims cached data", () => {
    const form = readFileSync("components/ConnectionsForm.tsx", "utf8");
    expect(form).toMatch(/throttled: \{ text: "[^"]+", tone: "neutral" \}/);
    expect(form).toMatch(/status === "throttled" \? toneSoft\.neutral : toneSoft\.danger/);
    expect(messageFor("throttled")).not.toMatch(/synced data|still here/i);
    // the credentials route stores + returns the validation status verbatim
    const route = readFileSync("app/api/canvas/credentials/route.ts", "utf8");
    expect(route).toMatch(/lastValidationStatus: v\.status/);
    expect(route).toMatch(/status: v\.status/);
  });
});
