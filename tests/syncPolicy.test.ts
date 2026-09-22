// Canvas sync policy (T2, 2026-09-21): the ONE mount/focus/manual decision is
// pure and table-tested; quick mode writes only submission fields; and the two
// auto-syncing views go through the shared hook (no sessionStorage flag, which
// Chrome restores on tab restore and left long-lived tabs un-synced for days).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";

// --- mocks for the quick-mode runSync test (no Postgres, no Canvas) ---
vi.mock("@/lib/prisma", () => ({
  prisma: {
    canvasCredential: { findUnique: vi.fn(), update: vi.fn() },
    course: { findMany: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    assignment: { upsert: vi.fn() },
    announcement: { upsert: vi.fn() },
  },
}));
vi.mock("@/lib/canvas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/canvas")>();
  return {
    ...real,
    validateCredentials: vi.fn(),
    fetchCourses: vi.fn(),
    fetchAssignments: vi.fn(),
    fetchAnnouncements: vi.fn(),
    fetchAssignmentGroups: vi.fn(),
    fetchSyllabus: vi.fn(),
  };
});

import { prisma } from "@/lib/prisma";
import { validateCredentials, fetchCourses, fetchAssignments, fetchAnnouncements, CanvasError } from "@/lib/canvas";
import { runSync, quickAssignmentData, QUICK_LIVE_WINDOW_MS } from "@/lib/sync";
import { syncDecision, parseTrigger, MOUNT_FRESH_MS } from "@/lib/syncPolicy";
import { fetchAssignmentGroups, fetchSyllabus } from "@/lib/canvas";

type Fn = ReturnType<typeof vi.fn>;
const credFind = prisma.canvasCredential.findUnique as unknown as Fn;
const credUpdate = prisma.canvasCredential.update as unknown as Fn;
const courseFindMany = prisma.course.findMany as unknown as Fn;
const courseUpsert = prisma.course.upsert as unknown as Fn;
const assignmentUpsert = prisma.assignment.upsert as unknown as Fn;
const vValidate = validateCredentials as unknown as Fn;
const vCourses = fetchCourses as unknown as Fn;
const vAssignments = fetchAssignments as unknown as Fn;
const vAnnouncements = fetchAnnouncements as unknown as Fn;
const vGroups = fetchAssignmentGroups as unknown as Fn;
const vSyllabus = fetchSyllabus as unknown as Fn;

const NOW = new Date("2026-09-21T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe("syncDecision (the one mount/focus/manual rule)", () => {
  it("manual → full, no matter how fresh", () => {
    expect(syncDecision("manual", null, NOW)).toBe("full");
    expect(syncDecision("manual", ago(1000), NOW)).toBe("full");
    expect(syncDecision("manual", NOW.toISOString(), NOW)).toBe("full");
  });
  it("mount → full when never synced", () => {
    expect(syncDecision("mount", null, NOW)).toBe("full");
  });
  it("mount → skip inside the 10-minute window (9m59s), full just outside it (10m01s)", () => {
    expect(syncDecision("mount", ago(9 * 60_000 + 59_000), NOW)).toBe("skip");
    expect(syncDecision("mount", ago(10 * 60_000 + 1_000), NOW)).toBe("full");
    expect(syncDecision("mount", ago(6 * 24 * 60 * 60_000), NOW)).toBe("full"); // the Sept-15 bug
  });
  it("mount → full on a malformed timestamp (never trust a bad value as fresh)", () => {
    expect(syncDecision("mount", "not-a-date", NOW)).toBe("full");
  });
  it("focus → quick regardless of freshness (the client + route throttle it)", () => {
    expect(syncDecision("focus", null, NOW)).toBe("quick");
    expect(syncDecision("focus", ago(1000), NOW)).toBe("quick");
    expect(syncDecision("focus", ago(2 * MOUNT_FRESH_MS), NOW)).toBe("quick");
  });
});

describe("parseTrigger (request body → trigger)", () => {
  it("missing / empty / invalid body → manual (today's body-less callers keep a full sync)", () => {
    expect(parseTrigger(null)).toBe("manual");
    expect(parseTrigger(undefined)).toBe("manual");
    expect(parseTrigger({})).toBe("manual");
    expect(parseTrigger("mount")).toBe("manual");
    expect(parseTrigger({ trigger: "bogus" })).toBe("manual");
    expect(parseTrigger({ trigger: 1 })).toBe("manual");
  });
  it("recognised triggers pass through", () => {
    expect(parseTrigger({ trigger: "mount" })).toBe("mount");
    expect(parseTrigger({ trigger: "focus" })).toBe("focus");
    expect(parseTrigger({ trigger: "manual" })).toBe("manual");
  });
});

describe("runSync quick mode", () => {
  const PREV = new Date("2026-09-15T08:00:00Z");
  const canvasAssignment = (id: number) => ({
    id,
    name: `A${id}`,
    due_at: "2026-09-30T04:59:00Z",
    points_possible: 10,
    html_url: `https://canvas.test/a/${id}`,
    description: "<p>body</p>",
    submission_types: ["online_upload"],
    assignment_group_id: 77,
    submission: { submitted_at: "2026-09-21T10:00:00Z", score: 9, submission_type: "online_upload", workflow_state: "graded" },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    credFind.mockResolvedValue({ userId: 1, host: "canvas.test", token: "raw-token", syncedAt: PREV });
    credUpdate.mockResolvedValue({});
    courseFindMany.mockResolvedValue([
      { id: 11, canvasId: 101, name: "Micro" },
      { id: 12, canvasId: 102, name: "Finance" },
    ]);
    assignmentUpsert.mockResolvedValue({});
    vValidate.mockResolvedValue({ status: "valid", accountName: "Calvin" });
  });

  it("validates, reads courses from the DB (not /courses), fetches assignments only, keeps syncedAt", async () => {
    vAssignments.mockResolvedValue([canvasAssignment(1)]);
    const r = await runSync(1, { mode: "quick" });

    expect(vValidate).toHaveBeenCalledTimes(1);
    expect(vCourses).not.toHaveBeenCalled();
    expect(vAnnouncements).not.toHaveBeenCalled();
    expect(courseUpsert).not.toHaveBeenCalled();
    expect(courseFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: 1, excludedAt: null }) }));
    expect(vAssignments).toHaveBeenCalledTimes(2); // one per course row
    expect(vAssignments).toHaveBeenCalledWith("canvas.test", "raw-token", 101, expect.any(Number)); // 4th = the run's deadline (#123)
    expect(vAssignments).toHaveBeenCalledWith("canvas.test", "raw-token", 102, expect.any(Number));

    expect(r).toMatchObject({ ok: true, status: "valid", message: "Refreshed submissions.", failedCourses: [], mode: "quick" });
    expect(r.syncedAt).toBe(PREV.toISOString()); // quick never advances the FULL-sync stamp
    // the only credential writes are the validation status ones (no syncedAt)
    for (const call of credUpdate.mock.calls) expect(call[0].data).not.toHaveProperty("syncedAt");
  });

  it("upserts ONLY the submission-bearing fields (never group/weight/manualDone/AI fields)", async () => {
    vAssignments.mockResolvedValueOnce([canvasAssignment(1)]).mockResolvedValueOnce([]);
    await runSync(1, { mode: "quick" });

    expect(assignmentUpsert).toHaveBeenCalledTimes(1);
    const arg = assignmentUpsert.mock.calls[0][0];
    expect(arg.where).toEqual({ userId_canvasId: { userId: 1, canvasId: 1 } });
    expect(Object.keys(arg.update).sort()).toEqual(
      ["userId", "courseId", "courseCanvasId", "name", "dueAt", "pointsPossible", "htmlUrl", "submissionType", "description", "submittedAt", "submissionScore", "submissionState"].sort(),
    );
    expect(arg.update).toMatchObject({
      courseId: 11,
      courseCanvasId: 101,
      submittedAt: new Date("2026-09-21T10:00:00Z"),
      submissionScore: 9,
      submissionState: "graded",
      submissionType: "online_upload",
    });
    expect(arg.create).toEqual({ canvasId: 1, ...arg.update });
    for (const k of ["gradeWeight", "groupId", "groupName", "groupWeight", "manualDoneAt", "estimatedEffortHours", "aiSummary"]) {
      expect(arg.update).not.toHaveProperty(k);
      expect(arg.create).not.toHaveProperty(k);
    }
  });

  it("one failing course → partial warning, other course still written, cache kept", async () => {
    vAssignments.mockRejectedValueOnce(new CanvasError("unreachable")).mockResolvedValueOnce([canvasAssignment(2)]);
    const r = await runSync(1, { mode: "quick" });
    expect(r.ok).toBe(true);
    expect(r.failedCourses).toEqual(["Micro"]);
    expect(r.message).toBe("Synced with warnings: couldn't refresh 1 course(s). Cached data kept.");
    expect(assignmentUpsert).toHaveBeenCalledTimes(1);
  });

  it("A: one course answers 401 (dropped/concluded course) → per-course failure only, token status untouched", async () => {
    vAssignments.mockImplementation((_h: string, _t: string, canvasId: number) =>
      canvasId === 101 ? Promise.reject(new CanvasError("invalid_token", 401)) : Promise.resolve([canvasAssignment(2)]),
    );
    const r = await runSync(1, { mode: "quick" });
    expect(r.ok).toBe(true);
    expect(r.status).toBe("valid");
    expect(r.failedCourses).toEqual(["Micro"]);
    expect(assignmentUpsert).toHaveBeenCalledTimes(1);
    // the only credential write is step 1's "valid" — never an invalid_token demotion
    expect(credUpdate).toHaveBeenCalledTimes(1);
    expect(credUpdate.mock.calls[0][0].data.lastValidationStatus).toBe("valid");
    for (const call of credUpdate.mock.calls) expect(call[0].data.lastValidationStatus).not.toBe("invalid_token");
  });

  it("1: EVERY course answers 401 (a student with one dropped course) → stale, NO token-level write", async () => {
    vAssignments.mockRejectedValue(new CanvasError("invalid_token", 401));
    const r = await runSync(1, { mode: "quick" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe("unreachable");
    expect(r.message).toBe("Couldn't refresh any courses right now. Showing cached data.");
    expect(r.failedCourses).toEqual(["Micro", "Finance"]);
    expect(r.syncedAt).toBe(PREV.toISOString());
    // the ONLY credential write in quick mode is step 1's validation result
    expect(credUpdate).toHaveBeenCalledTimes(1);
    expect(credUpdate.mock.calls[0][0].data).toMatchObject({ lastValidationStatus: "valid" });
  });

  it("1: a single cached course that 401s (the 'every course' edge) → still no token-level write", async () => {
    courseFindMany.mockResolvedValue([{ id: 11, canvasId: 101, name: "Micro" }]);
    vAssignments.mockRejectedValue(new CanvasError("insufficient_scope", 403));
    const r = await runSync(1, { mode: "quick" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe("unreachable");
    expect(credUpdate).toHaveBeenCalledTimes(1);
    expect(credUpdate.mock.calls[0][0].data.lastValidationStatus).toBe("valid");
  });

  it("every course fails, mixed 401 + unreachable → status unreachable, no credential write beyond step 1", async () => {
    vAssignments.mockImplementation((_h: string, _t: string, canvasId: number) =>
      Promise.reject(canvasId === 101 ? new CanvasError("invalid_token", 401) : new CanvasError("unreachable")),
    );
    const r = await runSync(1, { mode: "quick" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe("unreachable");
    expect(r.failedCourses).toEqual(["Micro", "Finance"]);
    expect(credUpdate).toHaveBeenCalledTimes(1);
    expect(credUpdate.mock.calls[0][0].data.lastValidationStatus).toBe("valid");
  });

  it("2: only courses with live-looking work are refreshed (due in the last 60 days / later, or undated)", async () => {
    vAssignments.mockResolvedValue([]);
    const before = Date.now();
    await runSync(1, { mode: "quick" });
    const where = courseFindMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ userId: 1, excludedAt: null });
    const or = where.assignments.some.OR;
    expect(or).toHaveLength(2);
    expect(or[1]).toEqual({ dueAt: null });
    const cutoff: Date = or[0].dueAt.gte;
    const expected = before - QUICK_LIVE_WINDOW_MS;
    expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(5_000);
  });

  it("F: zero non-excluded courses → ok, 'Nothing to refresh yet.', no Canvas call", async () => {
    courseFindMany.mockResolvedValue([]);
    const r = await runSync(1, { mode: "quick" });
    expect(r).toMatchObject({ ok: true, status: "valid", message: "Nothing to refresh yet.", failedCourses: [], mode: "quick" });
    expect(vAssignments).not.toHaveBeenCalled();
  });

  it("J: courses are fetched in parallel (all fetches start before any resolves)", async () => {
    let started = 0;
    const resolvers: Array<() => void> = [];
    vAssignments.mockImplementation(
      () =>
        new Promise<unknown[]>((resolve) => {
          started++;
          resolvers.push(() => resolve([]));
        }),
    );
    const p = runSync(1, { mode: "quick" });
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toBe(2);
    resolvers.forEach((r) => r());
    await expect(p).resolves.toMatchObject({ ok: true });
  });

  it("invalid credentials abort before any course read (same as full)", async () => {
    vValidate.mockResolvedValue({ status: "invalid_token", httpCode: 401 });
    const r = await runSync(1, { mode: "quick" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe("invalid_token");
    expect(courseFindMany).not.toHaveBeenCalled();
    expect(vAssignments).not.toHaveBeenCalled();
  });

  it("quickAssignmentData carries no group/weight keys", () => {
    const d = quickAssignmentData(canvasAssignment(5), { userId: 1, courseId: 11, courseCanvasId: 101 });
    expect(d).not.toHaveProperty("gradeWeight");
    expect(d).not.toHaveProperty("groupId");
    expect(d.name).toBe("A5");
  });
});

describe("runSync full mode (write shape pinned)", () => {
  const PREV = new Date("2026-09-15T08:00:00Z");
  beforeEach(() => {
    vi.clearAllMocks();
    credFind.mockResolvedValue({ userId: 1, host: "canvas.test", token: "raw-token", syncedAt: PREV });
    credUpdate.mockResolvedValue({});
    vValidate.mockResolvedValue({ status: "valid" });
    vCourses.mockResolvedValue([{ id: 101, name: "Micro", enrollments: [] }]);
    courseUpsert.mockResolvedValue({ id: 11 });
    vAnnouncements.mockResolvedValue([]);
    vGroups.mockResolvedValue([{ id: 77, name: "Homework", group_weight: 40, assignments: [{ id: 1, points_possible: 10 }] }]);
    vSyllabus.mockResolvedValue(null);
    assignmentUpsert.mockResolvedValue({});
  });

  it("upserts exactly the 16 assignment keys (quick's 12 + the 4 grade-group keys)", async () => {
    vAssignments.mockResolvedValue([
      {
        id: 1,
        name: "A1",
        due_at: "2026-09-30T04:59:00Z",
        points_possible: 10,
        html_url: "https://canvas.test/a/1",
        description: null,
        submission_types: ["online_upload"],
        assignment_group_id: 77,
        submission: { submitted_at: null, score: null, submission_type: null, workflow_state: "unsubmitted" },
      },
    ]);
    const r = await runSync(1); // default = full
    expect(r).toMatchObject({ ok: true, mode: "full", message: "Sync complete." });
    expect(vCourses).toHaveBeenCalledTimes(1);
    expect(assignmentUpsert).toHaveBeenCalledTimes(1);
    const arg = assignmentUpsert.mock.calls[0][0];
    expect(Object.keys(arg.update).sort()).toEqual(
      [
        "userId", "courseId", "courseCanvasId", "name", "dueAt", "pointsPossible", "htmlUrl", "submissionType", "description",
        "submittedAt", "submissionScore", "submissionState", "gradeWeight", "groupId", "groupName", "groupWeight",
      ].sort(),
    );
    expect(arg.update).toMatchObject({ groupId: 77, groupName: "Homework", groupWeight: 40, submissionState: "unsubmitted" });
    expect(arg.update).toHaveProperty("gradeWeight"); // value is lib/gradeWeight's business, not pinned here
    expect(arg.create).toEqual({ canvasId: 1, ...arg.update });
    // full mode DOES advance the stamp
    expect(credUpdate).toHaveBeenLastCalledWith({ where: { userId: 1 }, data: { syncedAt: expect.any(Date) } });
  });
});

// --- grep guards (style of tests/singleSource.test.ts) ---
describe("auto-sync wiring guards", () => {
  const dashboard = readFileSync("components/DashboardView.tsx", "utf8");
  const calendar = readFileSync("components/CalendarView.tsx", "utf8");
  const route = readFileSync("app/api/sync/route.ts", "utf8");
  const sync = readFileSync("lib/sync.ts", "utf8");

  it("Dashboard and Calendar no longer gate sync on the sp_autosynced sessionStorage flag", () => {
    expect(dashboard).not.toContain("sp_autosynced");
    expect(calendar).not.toContain("sp_autosynced");
  });
  it("Dashboard and Calendar both sync through the shared hook", () => {
    expect(dashboard).toMatch(/import \{ useAutoSync \} from "@\/components\/useAutoSync"/);
    expect(calendar).toMatch(/import \{ useAutoSync \} from "@\/components\/useAutoSync"/);
    expect(dashboard).toContain("useAutoSync({");
    expect(calendar).toContain("useAutoSync({");
    // both surface the hook's warning line (quiet, neutral — never red)
    for (const src of [dashboard, calendar]) {
      expect(src).toMatch(/\{syncWarning && \([\s\S]*?text-\[13px\] text-muted[\s\S]*?\{syncWarning\}/);
    }
    expect(readFileSync("components/PlanView.tsx", "utf8")).not.toContain("sp_autosynced");
  });
  it("/api/sync declares a function budget", () => {
    expect(route).toMatch(/export const maxDuration = \d+;/);
    expect(route).toMatch(/export const dynamic = "force-dynamic";/);
  });
  it("lib/syncPolicy is pure: no prisma / node: / server imports (the hook bundles it)", () => {
    const policy = readFileSync("lib/syncPolicy.ts", "utf8");
    // import lines only (comments may name what's banned)
    const imports = policy.split("\n").filter((l) => /^\s*(import|export .* from)\b/.test(l));
    expect(imports).toEqual([]); // the policy file imports nothing at all
    expect(policy).not.toMatch(/require\(|fetch\(/);
    expect(policy).toMatch(/export function syncDecision/);
    expect(readFileSync("components/useAutoSync.ts", "utf8")).toMatch(/from "@\/lib\/syncPolicy"/);
  });
  it("H: /plan passes the real demo flag to CalendarView (bare `demo` made every real user's sync inert)", () => {
    const plan = readFileSync("components/PlanSurface.tsx", "utf8");
    expect(plan).toMatch(/<CalendarView [^>]*demo=\{demo\}/);
    expect(plan).not.toMatch(/<CalendarView [^>]*\sdemo\s/);
  });
  it("I: the FirstSync flow no longer sets the retired sessionStorage guard", () => {
    expect(readFileSync("components/FirstSyncProgress.tsx", "utf8")).not.toContain("sp_autosynced");
  });
  it("quick-mode upsert data (quickAssignmentData) never mentions the full-sync-only fields", () => {
    const m = sync.match(/export function quickAssignmentData[\s\S]*?\n\}\n/);
    expect(m).not.toBeNull();
    const body = m![0];
    for (const k of ["gradeWeight", "groupId", "groupName", "groupWeight", "manualDoneAt", "estimatedEffortHours", "aiSummary", "effortOverrideHours"]) {
      expect(body).not.toContain(`${k}:`);
    }
    // and the quick runner writes only through that helper
    const q = sync.match(/async function runQuickSync[\s\S]*$/);
    expect(q).not.toBeNull();
    expect(q![0]).toContain("quickAssignmentData(");
    expect(q![0]).not.toMatch(/gradeWeight|groupId|fetchAnnouncements|fetchAssignmentGroups|fetchSyllabus|analyzeLatePolicies|fetchCourses/);
    // and never touches the credential row (token status is full-sync business only)
    expect(q![0]).not.toMatch(/canvasCredential|lastValidationStatus|credentialError/);
  });
});
