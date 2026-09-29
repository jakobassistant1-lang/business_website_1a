// 2026-09-28: Canvas availability fields (unlock_at / lock_at / locked_for_user)
// are stored by BOTH sync modes; the student's Canvas profile zone is stored on
// connect and every full sync (fail-open, never overwritten with null); and a full
// sync writes every assignment's grade share through lib/gradeWeight (#144).
// Global fetch is stubbed (routed by URL) — no live Canvas, no Gemini.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    canvasCredential: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })), upsert: vi.fn() },
    course: { findMany: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    assignment: { upsert: vi.fn(), update: vi.fn() },
    announcement: { upsert: vi.fn() },
    user: { update: vi.fn() },
  },
}));
vi.mock("@/lib/access", () => ({ requireActiveUser: vi.fn(async () => ({ id: 1 })) }));
vi.mock("@/lib/funnel", () => ({ logEvent: vi.fn(async () => {}), logFirst: vi.fn(async () => {}) }));

import { prisma } from "@/lib/prisma";
import * as latePolicy from "@/lib/latePolicy";
import { CANVAS_RETRY, fetchProfileTimeZone } from "@/lib/canvas";
import { runSync, refreshStudentZone } from "@/lib/sync";
import { normalizeZone } from "@/lib/studentZone";
import { POST as saveCredentials } from "@/app/api/canvas/credentials/route";

type Fn = ReturnType<typeof vi.fn>;
const credFind = prisma.canvasCredential.findUnique as unknown as Fn;
const credUpdate = prisma.canvasCredential.update as unknown as Fn;
const credUpsert = prisma.canvasCredential.upsert as unknown as Fn;
const courseFindMany = prisma.course.findMany as unknown as Fn;
const courseUpsert = prisma.course.upsert as unknown as Fn;
const courseUpdate = prisma.course.update as unknown as Fn;
const assignmentUpsert = prisma.assignment.upsert as unknown as Fn;
const assignmentUpdate = prisma.assignment.update as unknown as Fn;
const userUpdate = prisma.user.update as unknown as Fn;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function routeFetch(handlers: Array<[RegExp, () => Response]>) {
  const fn = vi.fn(async (input: unknown) => {
    const url = String(input);
    for (const [re, h] of handlers) if (re.test(url)) return h();
    return json([]);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const LOCKED = {
  id: 1,
  name: "Homework 1",
  due_at: "2026-10-05T03:59:00Z",
  points_possible: 10,
  html_url: "u",
  description: null,
  unlock_at: "2026-10-01T04:00:00Z",
  lock_at: "2026-10-06T03:59:00Z",
  locked_for_user: true,
};
const OPEN = { ...LOCKED, locked_for_user: false };

const ORIGINAL_RETRY = { ...CANVAS_RETRY };
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(CANVAS_RETRY, { baseMs: 1, jitterMs: 0 });
  credFind.mockResolvedValue({ userId: 1, host: "canvas.test", token: "raw-token", syncedAt: null });
  credUpdate.mockResolvedValue({});
  credUpsert.mockResolvedValue({});
  courseUpsert.mockImplementation(async ({ where }: { where: { userId_canvasId: { canvasId: number } } }) => ({ id: 1000 + where.userId_canvasId.canvasId, gradingScheme: null }));
  courseUpdate.mockResolvedValue({});
  assignmentUpsert.mockResolvedValue({});
  assignmentUpdate.mockResolvedValue({});
  userUpdate.mockResolvedValue({});
  vi.spyOn(Date, "now").mockReturnValue(3_600_000);
});
afterEach(() => {
  Object.assign(CANVAS_RETRY, ORIGINAL_RETRY);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const baseRoutes = (assignments: unknown[], profile: () => Response = () => json({ time_zone: "America/Chicago" })): Array<[RegExp, () => Response]> => [
  [/users\/self\/profile/, profile],
  [/users\/self/, () => json({ name: "Calvin" })],
  [/\/courses\?/, () => json([{ id: 101, name: "Micro", enrollments: [{ type: "student" }] }])],
  [/courses\/101\/assignments/, () => json(assignments)],
];

describe("availability fields", () => {
  it("full sync writes unlockAt / lockAt / lockedForUser", async () => {
    routeFetch(baseRoutes([LOCKED]));
    const r = await runSync(1, { mode: "full" });
    expect(r.ok).toBe(true);
    expect(assignmentUpsert.mock.calls[0][0].update).toMatchObject({
      unlockAt: new Date("2026-10-01T04:00:00Z"),
      lockAt: new Date("2026-10-06T03:59:00Z"),
      lockedForUser: true,
    });
  });

  it("quick sync writes them too, so an item opened mid-week flips on the next refresh", async () => {
    courseFindMany.mockResolvedValue([{ id: 1101, canvasId: 101, name: "Micro" }]);
    routeFetch(baseRoutes([OPEN]));
    await runSync(1, { mode: "quick" });
    const data = assignmentUpsert.mock.calls[0][0].update;
    expect(data).toMatchObject({ lockedForUser: false, unlockAt: new Date("2026-10-01T04:00:00Z") });
    expect(data).not.toHaveProperty("gradeWeight"); // quick never touches (or nulls) the share
    expect(userUpdate).not.toHaveBeenCalled(); // the zone is a full-sync / connect read
  });

  it("missing fields → null (malformed dates too)", async () => {
    routeFetch(baseRoutes([{ id: 2, name: "HW", due_at: null, points_possible: 1, html_url: "u", description: null, unlock_at: "garbage" }]));
    await runSync(1, { mode: "full" });
    expect(assignmentUpsert.mock.calls[0][0].update).toMatchObject({ unlockAt: null, lockAt: null, lockedForUser: null });
  });
});

describe("student time zone (Canvas profile)", () => {
  it("full sync stores a valid profile zone on User.timeZone", async () => {
    const fetchMock = routeFetch(baseRoutes([OPEN]));
    await runSync(1, { mode: "full" });
    expect(fetchMock.mock.calls.some((c) => /\/users\/self\/profile$/.test(String(c[0])))).toBe(true);
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: 1 }, data: { timeZone: "America/Chicago" } });
  });

  it("a profile failure keeps the old zone (no write) and never fails the sync", async () => {
    routeFetch(baseRoutes([OPEN], () => json({ errors: [{ message: "boom" }] }, 500)));
    const r = await runSync(1, { mode: "full" });
    expect(r.ok).toBe(true);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("an unknown / empty zone is ignored (never overwrites a valid stored zone)", async () => {
    routeFetch(baseRoutes([OPEN], () => json({ time_zone: "Mars/Olympus_Mons" })));
    await runSync(1, { mode: "full" });
    routeFetch(baseRoutes([OPEN], () => json({ time_zone: null })));
    await runSync(1, { mode: "full" });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("a failing DB write is swallowed (fail-open) and only its CODE is logged", async () => {
    routeFetch(baseRoutes([OPEN]));
    userUpdate.mockRejectedValueOnce(Object.assign(new Error("where { id: 1 } timeZone America/Chicago"), { code: "P2025" }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await refreshStudentZone(1, "canvas.test", "tok")).toBeNull();
    expect(warn).toHaveBeenCalledWith("[sync] time zone not saved", "P2025");
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/America|id: 1/);
    const r = await runSync(1, { mode: "full" });
    expect(r.ok).toBe(true);
  });

  it("Canvas Rails zone names are mapped to IANA", async () => {
    expect(normalizeZone("Eastern Time (US & Canada)")).toBe("America/New_York");
    expect(normalizeZone("Central Time (US & Canada)")).toBe("America/Chicago");
    expect(normalizeZone("Mountain Time (US & Canada)")).toBe("America/Denver");
    expect(normalizeZone("Arizona")).toBe("America/Phoenix");
    expect(normalizeZone("Pacific Time (US & Canada)")).toBe("America/Los_Angeles");
    expect(normalizeZone("Alaska")).toBe("America/Anchorage");
    expect(normalizeZone("Hawaii")).toBe("Pacific/Honolulu");
    expect(normalizeZone("Indiana (East)")).toBe("America/Indiana/Indianapolis");
    expect(normalizeZone("Atlantic Time (Canada)")).toBe("America/Halifax");
    expect(normalizeZone("Puerto Rico")).toBe("America/Puerto_Rico");
    expect(normalizeZone("Europe/Berlin")).toBe("Europe/Berlin");
    expect(normalizeZone("Narnia Time")).toBeNull();
    expect(normalizeZone(42)).toBeNull();
    routeFetch([[/profile/, () => json({ time_zone: "Pacific Time (US & Canada)" })]]);
    expect(await fetchProfileTimeZone("canvas.test", "tok")).toBe("America/Los_Angeles");
  });

  it("a course upsert that throws is that course's failure; the zone is still saved", async () => {
    routeFetch(baseRoutes([OPEN]));
    courseUpsert.mockRejectedValueOnce(new Error("db down"));
    const r = await runSync(1, { mode: "full" });
    expect(r).toMatchObject({ ok: false, failedCourses: ["Micro"] });
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: 1 }, data: { timeZone: "America/Chicago" } });
  });

  it("fetchProfileTimeZone validates the zone", async () => {
    routeFetch([[/profile/, () => json({ time_zone: " Europe/Berlin " })]]);
    expect(await fetchProfileTimeZone("canvas.test", "tok")).toBe("Europe/Berlin");
    routeFetch([[/profile/, () => new Response("not json", { status: 200 })]]);
    expect(await fetchProfileTimeZone("canvas.test", "tok")).toBeNull();
  });

  it("saving credentials stores the zone; a profile error never fails the connect", async () => {
    routeFetch(baseRoutes([]));
    const req = () => new Request("http://x/api/canvas/credentials", { method: "POST", body: JSON.stringify({ host: "canvas.test", token: "tok" }) });
    let res = await saveCredentials(req());
    expect((await res.json()).status).toBe("valid");
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: 1 }, data: { timeZone: "America/Chicago" } });

    userUpdate.mockClear();
    routeFetch(baseRoutes([], () => json({}, 401)));
    res = await saveCredentials(req());
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("valid");
    expect(userUpdate).not.toHaveBeenCalled();
  });
});

describe("grade share written on full sync (#144)", () => {
  const item = (id: number, points: number, name = `Case ${id}`) => ({ id, name, due_at: null, points_possible: points, html_url: "u", description: null });
  const shareOf = (id: number) => assignmentUpsert.mock.calls.find((c) => c[0].where.userId_canvasId.canvasId === id)?.[0].update.gradeWeight;

  it("thin course (one 100-pt item) → type default, not 1.0", async () => {
    routeFetch(baseRoutes([item(1, 100)]));
    await runSync(1, { mode: "full" });
    expect(shareOf(1)).toBe(0.06);
  });

  it("6 pointed items → share of posted points", async () => {
    routeFetch(baseRoutes([item(1, 50), ...[2, 3, 4, 5, 6].map((i) => item(i, 10))]));
    await runSync(1, { mode: "full" });
    expect(shareOf(1)).toBeCloseTo(0.5, 9);
  });

  it("the syllabus scheme read in the same run is stored with the policy and re-shares the course at once", async () => {
    const spy = vi.spyOn(latePolicy, "analyzeLatePolicies").mockResolvedValue({
      ok: true,
      source: "gemini",
      items: [{ courseId: 101, policy: { kind: "flat", value: 0 }, grading: { categories: [{ name: "Homework", weight: 0.2, count: 10 }] } }],
    });
    routeFetch([...baseRoutes([item(1, 10, "Homework 1"), item(2, 10, "Homework 2")]), [/courses\/101\?include\[\]=syllabus_body/, () => json({ syllabus_body: "<p>Homework 20%, 10 sets.</p>" })]]);
    await runSync(1, { mode: "full" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(courseUpdate).toHaveBeenCalledWith({
      where: { id: 1101 },
      data: expect.objectContaining({ latePolicyKind: "flat", latePolicyValue: 0, gradingScheme: { categories: [{ name: "Homework", weight: 0.2, count: 10 }] } }),
    });
    expect(shareOf(1)).toBe(0.06); // first pass: no stored scheme yet
    expect(assignmentUpdate).toHaveBeenCalledWith({ where: { userId_canvasId: { userId: 1, canvasId: 1 } }, data: { gradeWeight: expect.closeTo(0.02, 9) } });
    expect(assignmentUpdate).toHaveBeenCalledTimes(2);
  });

  it("a groups read that FAILED leaves gradeWeight + group fields untouched (≠ a course with no groups)", async () => {
    routeFetch([...baseRoutes([item(1, 100)]), [/assignment_groups/, () => json({}, 500)]]);
    await runSync(1, { mode: "full" });
    const data = assignmentUpsert.mock.calls[0][0].update;
    expect(data).not.toHaveProperty("gradeWeight");
    expect(data).not.toHaveProperty("groupName");
    expect(data).not.toHaveProperty("groupWeight");
    // an empty (successful) groups list still writes the share
    assignmentUpsert.mockClear();
    routeFetch([...baseRoutes([item(1, 100)]), [/assignment_groups/, () => json([])]]);
    await runSync(1, { mode: "full" });
    expect(assignmentUpsert.mock.calls[0][0].update.gradeWeight).toBe(0.06);
  });

  it("a cut-off entry stores its policy WITHOUT hash or grading; a failed course update skips the re-share", async () => {
    const spy = vi.spyOn(latePolicy, "analyzeLatePolicies").mockResolvedValue({
      ok: true,
      source: "gemini",
      items: [{ courseId: 101, policy: { kind: "perday", value: 0.1 }, truncated: true }],
    });
    const routes: Array<[RegExp, () => Response]> = [...baseRoutes([item(1, 10, "Homework 1")]), [/courses\/101\?include\[\]=syllabus_body/, () => json({ syllabus_body: "<p>x</p>" })]];
    routeFetch(routes);
    await runSync(1, { mode: "full" });
    expect(courseUpdate).toHaveBeenCalledWith({ where: { id: 1101 }, data: { latePolicyKind: "perday", latePolicyValue: 0.1 } });

    courseUpdate.mockClear();
    spy.mockResolvedValue({ ok: true, source: "gemini", items: [{ courseId: 101, policy: { kind: "none", value: 0 }, grading: { categories: [{ name: "Homework", weight: 0.2, count: 10 }] } }] });
    courseUpdate.mockRejectedValueOnce(new Error("db down"));
    routeFetch(routes);
    await runSync(1, { mode: "full" });
    expect(courseUpdate).toHaveBeenCalledTimes(1);
    expect(assignmentUpdate).not.toHaveBeenCalled();
  });

  it("a stored scheme is used directly (no re-share needed when unchanged)", async () => {
    courseUpsert.mockImplementation(async () => ({ id: 1101, gradingScheme: { totalPoints: 1000 } }));
    routeFetch(baseRoutes([item(1, 50)]));
    await runSync(1, { mode: "full" });
    expect(shareOf(1)).toBeCloseTo(0.05, 9);
    expect(assignmentUpdate).not.toHaveBeenCalled();
  });
});

describe("late-policy call timeout (20s, inside the sync budget)", () => {
  it("20s default; shortened near the end of the budget; never past budget + 10s", async () => {
    const { LATE_POLICY_TIMEOUT_MS } = await import("@/lib/latePolicy");
    const { latePolicyTimeoutMs, LATE_POLICY_GRACE_MS } = await import("@/lib/sync");
    expect(LATE_POLICY_TIMEOUT_MS).toBe(20_000);
    expect(LATE_POLICY_GRACE_MS).toBe(10_000);
    expect(latePolicyTimeoutMs(100_000, 50_000)).toBe(20_000); // plenty of budget left
    expect(latePolicyTimeoutMs(100_000, 95_000)).toBe(15_000); // 5s budget + 10s grace
    expect(latePolicyTimeoutMs(100_000, 120_000)).toBe(1_000); // floor (the call is skipped when over budget anyway)
  });

  it("the sync passes the budget-aware timeout to the Gemini read", async () => {
    const spy = vi.spyOn(latePolicy, "analyzeLatePolicies").mockResolvedValue({ ok: false, reason: "no_key" });
    routeFetch([...baseRoutes([]), [/courses\/101\?include\[\]=syllabus_body/, () => json({ syllabus_body: "<p>x</p>" })]]);
    await runSync(1, { mode: "full", budgetMs: 45_000 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][2]).toEqual({ timeoutMs: 20_000 });
  });
});
