// Persisted sync report (#132): pure builder/parser/copy, runSync writing it in
// BOTH modes (fail-open), and wiring guards for the Connections page.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    canvasCredential: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    course: { findMany: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    assignment: { upsert: vi.fn() },
    announcement: { upsert: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  buildSyncReport,
  courseLine,
  parseSyncReport,
  reasonForStatus,
  reasonText,
  runSummary,
  skippedNonStudentText,
  MAX_REPORT_ASSIGNMENTS,
  type SyncReportReason,
} from "@/lib/syncReport";
import { messageFor } from "@/lib/messages";
import { CANVAS_RETRY } from "@/lib/canvas";
import { runSync } from "@/lib/sync";

type Fn = ReturnType<typeof vi.fn>;
const credFind = prisma.canvasCredential.findUnique as unknown as Fn;
const credUpdate = prisma.canvasCredential.update as unknown as Fn;
const credUpdateMany = prisma.canvasCredential.updateMany as unknown as Fn;
const courseFindMany = prisma.course.findMany as unknown as Fn;
const courseUpsert = prisma.course.upsert as unknown as Fn;

const AT = new Date("2026-09-26T12:00:00Z");
const sample = () =>
  buildSyncReport({
    at: AT,
    mode: "full",
    result: { ok: true, status: "valid" },
    courses: [
      { canvasId: 101, name: "Micro", assignments: 12, ok: true },
      { canvasId: 102, name: "Finance", assignments: 0, ok: false, reason: "throttled" },
    ],
    skippedNonStudent: 2,
  });

describe("buildSyncReport / parseSyncReport", () => {
  it("builds a versioned report and round-trips through JSON", () => {
    const r = sample();
    expect(r).toEqual({
      version: 1,
      at: AT.toISOString(),
      mode: "full",
      ok: true,
      status: "valid",
      courses: [
        { canvasId: 101, name: "Micro", assignments: 12, ok: true },
        { canvasId: 102, name: "Finance", assignments: 0, ok: false, reason: "throttled" },
      ],
      skippedNonStudent: 2,
    });
    expect(parseSyncReport(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });

  it("defaults skippedNonStudent to 0 and drops a reason on an ok course", () => {
    const r = buildSyncReport({ at: AT, mode: "quick", result: { ok: true, status: "valid" }, courses: [{ canvasId: 1, name: "A", assignments: 1, ok: true, reason: "error" }] });
    expect(r.skippedNonStudent).toBe(0);
    expect(r.courses[0]).not.toHaveProperty("reason");
  });

  it("garbage → null, never throws", () => {
    for (const g of [null, undefined, 0, "x", [], true, { version: 2 }, Object.create(null)]) expect(parseSyncReport(g)).toBeNull();
  });

  it("any missing or mistyped field → null", () => {
    const base = JSON.parse(JSON.stringify(sample()));
    for (const k of ["version", "at", "mode", "ok", "status", "courses", "skippedNonStudent"]) {
      const copy = { ...base };
      delete copy[k];
      expect(parseSyncReport(copy)).toBeNull();
    }
    expect(parseSyncReport({ ...base, at: "not a date" })).toBeNull();
    expect(parseSyncReport({ ...base, mode: "turbo" })).toBeNull();
    expect(parseSyncReport({ ...base, skippedNonStudent: -1 })).toBeNull();
    expect(parseSyncReport({ ...base, courses: [{ canvasId: 1, name: "A", ok: true }] })).toBeNull(); // no count
    expect(parseSyncReport({ ...base, courses: [{ canvasId: 1, name: "A", assignments: 1, ok: false, reason: "nope" }] })).toBeNull();
  });

  it("tightened course rows: positive-integer id, non-empty trimmed name, capped count, deduped ids", () => {
    const base = JSON.parse(JSON.stringify(sample()));
    const row = { canvasId: 5, name: "A", assignments: 1, ok: true };
    for (const bad of [{ ...row, canvasId: 0 }, { ...row, canvasId: -3 }, { ...row, canvasId: 1.5 }, { ...row, name: "   " }, { ...row, assignments: 2.5 }]) {
      expect(parseSyncReport({ ...base, courses: [bad] })).toBeNull();
    }
    const r = parseSyncReport({ ...base, courses: [{ ...row, name: "  Stats  ", assignments: 99_999 }, { ...row, name: "dup" }, { ...row, canvasId: 6 }] });
    expect(r?.courses).toEqual([
      { canvasId: 5, name: "Stats", assignments: MAX_REPORT_ASSIGNMENTS, ok: true },
      { canvasId: 6, name: "A", assignments: 1, ok: true },
    ]);
  });

  it("extra fields are ignored (dropped)", () => {
    const base = JSON.parse(JSON.stringify(sample()));
    const withExtra = { ...base, junk: 1, courses: base.courses.map((c: object) => ({ ...c, extra: "x" })) };
    expect(parseSyncReport(withExtra)).toEqual(sample());
  });
});

describe("reasonText / courseLine / footer", () => {
  const ALL: SyncReportReason[] = ["unreachable", "throttled", "out_of_time", "invalid_token", "insufficient_scope", "restricted", "error"];
  it("every reason has non-empty plain-English copy", () => {
    for (const r of ALL) expect(reasonText(r).length).toBeGreaterThan(10);
    expect(new Set(ALL.map(reasonText)).size).toBe(ALL.length);
  });
  it("connection-level reasons reuse the FR-5 copy (single source)", () => {
    for (const r of ["unreachable", "throttled", "invalid_token", "insufficient_scope"] as const) expect(reasonText(r)).toBe(messageFor(r));
    expect(reasonText("out_of_time")).toBe("Didn't finish this time. It'll refresh on the next sync.");
    expect(reasonText("restricted")).toBe("Canvas hides this class's assignments.");
  });
  it("status → reason (quick treats 401/403 as a hidden class, not a bad token)", () => {
    expect(reasonForStatus("throttled")).toBe("throttled");
    expect(reasonForStatus("insufficient_scope")).toBe("insufficient_scope");
    expect(reasonForStatus("insufficient_scope", { quick: true })).toBe("restricted");
    expect(reasonForStatus("invalid_token", { quick: true })).toBe("restricted");
    expect(reasonForStatus("bad_domain")).toBe("error");
  });
  it("row text + footer", () => {
    expect(courseLine({ canvasId: 1, name: "A", assignments: 1, ok: true })).toBe("1 assignment");
    expect(courseLine({ canvasId: 1, name: "A", assignments: 7, ok: true })).toBe("7 assignments");
    expect(courseLine({ canvasId: 1, name: "A", assignments: 0, ok: false, reason: "out_of_time" })).toBe(reasonText("out_of_time"));
    expect(skippedNonStudentText(0)).toBeNull();
    expect(skippedNonStudentText(2)).toBe("Skipped 2 non-student course(s)."); // same text the sync message uses
  });
  it("run summary: null on success; FR-5 copy for the run status; unknown status → error copy", () => {
    expect(runSummary({ ok: true, status: "valid", courses: [] })).toBeNull();
    expect(runSummary({ ok: false, status: "bad_domain", courses: [] })).toEqual({ text: messageFor("bad_domain"), reason: "error" });
    expect(runSummary({ ok: false, status: "throttled", courses: [] })).toEqual({ text: messageFor("throttled"), reason: "throttled" });
    expect(runSummary({ ok: false, status: "weird", courses: [] })?.text).toBe(messageFor("error"));
    expect(runSummary({ ok: false, status: "error", courses: [] })?.text).not.toMatch(/this class/);
  });
  it("run summary: every class Canvas-hidden → matches the rows, never 'isn't responding'", () => {
    const hidden = { canvasId: 1, name: "A", assignments: 0, ok: false, reason: "restricted" as const };
    const s1 = runSummary({ ok: false, status: "unreachable", courses: [hidden, { ...hidden, canvasId: 2 }] });
    expect(s1?.reason).toBe("restricted");
    expect(s1?.text).not.toBe(messageFor("unreachable"));
    expect(s1?.text).toMatch(/hides/);
    // a mix falls back to the status copy
    expect(runSummary({ ok: false, status: "unreachable", courses: [hidden, { ...hidden, canvasId: 2, reason: "unreachable" }] })?.text).toBe(messageFor("unreachable"));
  });
});

// --- runSync writes the report --------------------------------------------------
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const throttle403 = () => new Response("403 Forbidden (Rate Limit Exceeded)", { status: 403 });
const genuine403 = () => json({ status: "unauthorized", errors: [{ message: "user not authorized to perform that action" }] }, 403);
const unauth401 = () => json({ errors: [{ message: "Invalid access token." }] }, 401);
function routeFetch(handlers: Array<[RegExp, () => Response]>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      for (const [re, h] of handlers) if (re.test(url)) return h();
      return json([]);
    }),
  );
}
const lastReport = () => credUpdateMany.mock.calls.at(-1)?.[0].data.lastSyncReport;

describe("runSync persists the report (fail-open)", () => {
  const ORIGINAL_RETRY = { ...CANVAS_RETRY };
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(CANVAS_RETRY, { baseMs: 1, jitterMs: 0 });
    credFind.mockResolvedValue({ userId: 1, host: "canvas.test", token: "raw-token", syncedAt: null, lastSyncReport: { version: 1, at: AT.toISOString(), mode: "full", ok: true, status: "valid", courses: [], skippedNonStudent: 4 } });
    credUpdate.mockResolvedValue({});
    credUpdateMany.mockResolvedValue({ count: 1 });
    courseUpsert.mockImplementation(async ({ where }: { where: { userId_canvasId: { canvasId: number } } }) => ({ id: 1000 + where.userId_canvasId.canvasId }));
    (prisma.assignment.upsert as unknown as Fn).mockResolvedValue({});
    vi.spyOn(Date, "now").mockReturnValue(3_600_000); // rotateByWindow offset 0 for 2 courses
  });
  afterEach(() => {
    Object.assign(CANVAS_RETRY, ORIGINAL_RETRY);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const hw = (id: number) => ({ id, name: `HW${id}`, due_at: null, points_possible: 1, html_url: "u", description: null });

  it("full: per-course counts + reasons, skippedNonStudent, only lastSyncReport written", async () => {
    routeFetch([
      [/users\/self/, () => json({ name: "Calvin" })],
      [/\/courses\?/, () => json([{ id: 101, name: "Micro", enrollments: [{ type: "student" }] }, { id: 102, name: "Finance", enrollments: [{ type: "student" }] }, { id: 103, name: "TA gig", enrollments: [{ type: "ta" }] }])],
      [/courses\/101\/assignments/, () => json([hw(1), hw(2)])],
      [/courses\/102\/assignments/, throttle403],
    ]);
    const r = await runSync(1, { mode: "full" });
    expect(r.ok).toBe(true);
    expect(credUpdateMany).toHaveBeenCalledTimes(1);
    expect(credUpdateMany.mock.calls[0][0]).toMatchObject({ where: { userId: 1 } });
    expect(Object.keys(credUpdateMany.mock.calls[0][0].data)).toEqual(["lastSyncReport"]);
    expect(parseSyncReport(lastReport())).toMatchObject({
      mode: "full",
      ok: true,
      status: "valid",
      skippedNonStudent: 1,
      courses: [
        { canvasId: 101, name: "Micro", assignments: 2, ok: true },
        { canvasId: 102, name: "Finance", assignments: 0, ok: false, reason: "throttled" },
      ],
    });
  });

  it("quick: lists only the courses it tried; carries the prior non-student count; 403 → restricted", async () => {
    courseFindMany.mockResolvedValue([{ id: 11, canvasId: 201, name: "Stats" }, { id: 12, canvasId: 202, name: "Old class" }]);
    routeFetch([
      [/users\/self/, () => json({ name: "Calvin" })],
      [/courses\/201\/assignments/, () => json([hw(5)])],
      [/courses\/202\/assignments/, () => json({ status: "unauthorized", errors: [{ message: "user not authorized" }] }, 403)],
    ]);
    const r = await runSync(1, { mode: "quick" });
    expect(r).toMatchObject({ ok: true, mode: "quick", failedCourses: ["Old class"] });
    expect(parseSyncReport(lastReport())).toMatchObject({
      mode: "quick",
      skippedNonStudent: 4,
      courses: [
        { canvasId: 201, assignments: 1, ok: true },
        { canvasId: 202, ok: false, reason: "restricted" },
      ],
    });
  });

  // One test per failure return: the persisted report AND the exact SyncResult
  // (the pre-#132 shape — no report fields leak into it). syncedAt is the stored
  // one (null here), so there are no timestamps to strip.
  const MICRO = { id: 101, name: "Micro", enrollments: [{ type: "student" }] };
  const FIN = { id: 102, name: "Finance", enrollments: [{ type: "student" }] };

  it("full, course list fails → report with no rows + the status; result unchanged", async () => {
    routeFetch([
      [/users\/self/, () => json({ name: "Calvin" })],
      [/\/courses\?/, genuine403],
    ]);
    const r = await runSync(1, { mode: "full" });
    expect(r).toEqual({ ok: false, status: "insufficient_scope", message: messageFor("insufficient_scope"), syncedAt: null, failedCourses: [], mode: "full" });
    expect(parseSyncReport(lastReport())).toMatchObject({ mode: "full", ok: false, status: "insufficient_scope", courses: [], skippedNonStudent: 0 });
  });

  it("full, token problem on a data call (4a) → failing row + token status; result unchanged", async () => {
    routeFetch([
      [/users\/self/, () => json({ name: "Calvin" })],
      [/\/courses\?/, () => json([MICRO, FIN])],
      [/courses\/101\/assignments/, unauth401],
      [/courses\/102\/assignments/, () => json([hw(1)])],
    ]);
    const r = await runSync(1, { mode: "full" });
    expect(r).toEqual({ ok: false, status: "invalid_token", message: messageFor("invalid_token"), syncedAt: null, failedCourses: ["Micro"], mode: "full" });
    expect(parseSyncReport(lastReport())).toMatchObject({
      ok: false,
      status: "invalid_token",
      courses: [
        { canvasId: 101, assignments: 0, ok: false, reason: "invalid_token" },
        { canvasId: 102, assignments: 1, ok: true },
      ],
    });
  });

  it("full, every course failed (4b) → all rows failed; result unchanged", async () => {
    routeFetch([
      [/users\/self/, () => json({ name: "Calvin" })],
      [/\/courses\?/, () => json([MICRO, FIN])],
      [/assignments/, throttle403],
    ]);
    const r = await runSync(1, { mode: "full" });
    expect(r).toEqual({ ok: false, status: "throttled", message: "Couldn't refresh any courses right now. Showing cached data.", syncedAt: null, failedCourses: ["Micro", "Finance"], mode: "full" });
    expect(parseSyncReport(lastReport())).toMatchObject({
      ok: false,
      status: "throttled",
      courses: [
        { canvasId: 101, ok: false, reason: "throttled" },
        { canvasId: 102, ok: false, reason: "throttled" },
      ],
    });
  });

  it("quick, every course failed 403 → rows 'restricted', summary matches them; result unchanged", async () => {
    courseFindMany.mockResolvedValue([{ id: 11, canvasId: 201, name: "Stats" }, { id: 12, canvasId: 202, name: "Old class" }]);
    routeFetch([
      [/users\/self/, () => json({ name: "Calvin" })],
      [/assignments/, genuine403],
    ]);
    const r = await runSync(1, { mode: "quick" });
    expect(r).toEqual({ ok: false, status: "unreachable", message: "Couldn't refresh any courses right now. Showing cached data.", syncedAt: null, failedCourses: ["Stats", "Old class"], mode: "quick" });
    const rep = parseSyncReport(lastReport());
    expect(rep).toMatchObject({
      mode: "quick",
      ok: false,
      status: "unreachable",
      courses: [
        { canvasId: 201, ok: false, reason: "restricted" },
        { canvasId: 202, ok: false, reason: "restricted" },
      ],
    });
    expect(runSummary(rep!)?.reason).toBe("restricted");
  });

  it("a failing report write (rejection OR sync throw) never changes the result", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    routeFetch([
      [/users\/self/, () => json({ name: "Calvin" })],
      [/\/courses\?/, () => json([{ id: 101, name: "Micro", enrollments: [{ type: "student" }] }])],
    ]);
    credUpdateMany.mockResolvedValue({ count: 1 });
    const good = await runSync(1, { mode: "full" });
    credUpdateMany.mockRejectedValue(new Error("db down"));
    const rejected = await runSync(1, { mode: "full" });
    credUpdateMany.mockImplementation(() => {
      throw new Error("sync throw");
    });
    const thrown = await runSync(1, { mode: "full" });
    const strip = (x: typeof good) => ({ ...x, syncedAt: "x" });
    expect(strip(rejected)).toEqual(strip(good));
    expect(strip(thrown)).toEqual(strip(good));
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toBe("[sync] report not saved");
  });

  it("no report on the no-connection / validation-failed early returns", async () => {
    credFind.mockResolvedValueOnce(null);
    await runSync(1);
    routeFetch([[/users\/self/, () => json({ errors: [{ message: "Invalid access token." }] }, 401)]]);
    const r = await runSync(1);
    expect(r.status).toBe("invalid_token");
    expect(credUpdateMany).not.toHaveBeenCalled();
  });
});

describe("wiring guards", () => {
  const sync = readFileSync("lib/sync.ts", "utf8");
  const quickBody = sync.slice(sync.indexOf("async function runQuickSync("));
  const fullBody = sync.slice(sync.indexOf("export async function runSync("), sync.indexOf("function syncMessage("));

  it("lib/sync.ts writes the report in BOTH the full and quick paths", () => {
    expect(fullBody).toContain("writeSyncReport(");
    expect(quickBody).toContain("writeSyncReport(");
  });
  it("the write is .catch-guarded (fail-open, logged)", () => {
    const helper = sync.slice(sync.indexOf("export async function writeSyncReport("));
    expect(helper.slice(0, helper.indexOf("\n}\n"))).toMatch(/lastSyncReport[\s\S]*\.catch\(\(e\) => \{\s*console\.warn\("\[sync\] report not saved", e\);\s*\}\)/);
  });
  it("one wording for skipped non-student courses: syncMessage uses skippedNonStudentText", () => {
    expect(sync).toContain("skippedNonStudentText(skippedNonStudent)");
    expect(sync).not.toMatch(/non-student course\(s\)/);
  });
  it("saving a different school clears the old report", () => {
    const route = readFileSync("app/api/canvas/credentials/route.ts", "utf8");
    expect(route).toMatch(/hostChanged \? \{ lastSyncReport: Prisma\.DbNull \}/);
  });
  it("the panel renders time client-side, not with suppressHydrationWarning on the server", () => {
    const panel = readFileSync("components/SyncReportPanel.tsx", "utf8");
    expect(panel).not.toContain("suppressHydrationWarning");
    expect(panel).not.toMatch(/^"use client"/);
    expect(panel).toContain("<LocalRelativeTime");
    expect(readFileSync("components/LocalRelativeTime.tsx", "utf8")).toMatch(/^"use client"/);
  });
  it("the Connections page renders <SyncReportPanel from the parsed report", () => {
    const page = readFileSync("app/(app)/connections/page.tsx", "utf8");
    expect(page).toContain("<SyncReportPanel");
    expect(page).toContain("parseSyncReport(cred.lastSyncReport)");
  });
});
