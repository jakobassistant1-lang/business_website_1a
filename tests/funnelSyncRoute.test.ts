// #111: /api/sync logs the user's first completed sync exactly when it should —
// inline for an in-time answer, via after() for a run that outlives the 50s
// deadline, never for joiners / fresh answers / already-synced accounts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const afterTasks: Array<() => unknown> = [];
vi.mock("next/server", async (importOriginal) => {
  const real = await importOriginal<typeof import("next/server")>();
  return { ...real, after: vi.fn((task: () => unknown) => void afterTasks.push(task)) };
});
vi.mock("@/lib/access", () => ({ requireActiveUser: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { canvasCredential: { findUnique: vi.fn() } } }));
vi.mock("@/lib/sync", () => ({ runSync: vi.fn() }));
vi.mock("@/lib/funnel", () => ({ logFirst: vi.fn(async () => {}) }));

import { requireActiveUser } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { runSync } from "@/lib/sync";
import { logFirst } from "@/lib/funnel";
import { POST } from "@/app/api/sync/route";

type Fn = ReturnType<typeof vi.fn>;
const vUser = requireActiveUser as unknown as Fn;
const vCred = prisma.canvasCredential.findUnique as unknown as Fn;
const vRun = runSync as unknown as Fn;
const vLog = logFirst as unknown as Fn;

const OK = { ok: true, status: "valid", message: "Canvas check complete.", syncedAt: null, failedCourses: [], mode: "full" };
let uid = 5000; // fresh user per test → the route's module-scope maps start empty
const post = (trigger = "manual") => POST(new Request("http://x/api/sync", { method: "POST", body: JSON.stringify({ trigger }) }));
const runAfterTasks = () => Promise.all(afterTasks.splice(0).map((t) => t()));
const tick = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  vi.clearAllMocks();
  afterTasks.length = 0;
  uid++;
  vUser.mockResolvedValue({ id: uid });
  vCred.mockResolvedValue({ syncedAt: null, lastValidationStatus: "valid" }); // never synced
});
afterEach(() => vi.useRealTimers());

describe("/api/sync first-sync funnel event (#111)", () => {
  it("in-time first sync → logged inline (before the response), once, even after after() runs", async () => {
    vRun.mockResolvedValue(OK);
    await post();
    expect(vLog).toHaveBeenCalledTimes(1);
    expect(vLog).toHaveBeenCalledWith("first_sync_ok", uid, { mode: "full", status: "valid", failedCourses: 0 });
    await runAfterTasks();
    expect(vLog).toHaveBeenCalledTimes(1); // memoized: after() reuses the same log
  });

  it("partial failure → first_sync_failed with the failed-course count", async () => {
    vRun.mockResolvedValue({ ...OK, ok: false, status: "error", failedCourses: ["A", "B"] });
    await post();
    expect(vLog).toHaveBeenCalledWith("first_sync_failed", uid, { mode: "full", status: "error", failedCourses: 2 });
  });

  it("runSync rejects → first_sync_failed", async () => {
    vRun.mockRejectedValue(new Error("boom"));
    const body = await (await post()).json();
    expect(body).toMatchObject({ ok: false, status: "error" });
    expect(vLog).toHaveBeenCalledWith("first_sync_failed", uid, expect.objectContaining({ status: "error" }));
  });

  it("timeout → not logged inline; logged via after() once the run settles", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let finish!: (r: unknown) => void;
    vRun.mockReturnValue(new Promise((r) => (finish = r)));
    const pending = post();
    while (!vRun.mock.calls.length) await tick(); // route reached the run + deadline timer
    await vi.advanceTimersByTimeAsync(50_000);
    const body = await (await pending).json();
    expect(body.skipped).toBe("timeout");
    expect(vLog).not.toHaveBeenCalled();
    finish(OK);
    await runAfterTasks();
    expect(vLog).toHaveBeenCalledTimes(1);
    expect(vLog).toHaveBeenCalledWith("first_sync_ok", uid, expect.objectContaining({ status: "valid" }));
  });

  it("in_flight joiner → not logged by the joiner (the owner logs once)", async () => {
    let finish!: (r: unknown) => void;
    vRun.mockReturnValue(new Promise((r) => (finish = r)));
    const owner = post();
    while (!vRun.mock.calls.length) await tick();
    const joiner = post();
    await tick();
    finish(OK);
    expect((await (await joiner).json()).skipped).toBe("in_flight");
    await owner;
    await runAfterTasks();
    expect(vRun).toHaveBeenCalledTimes(1);
    expect(vLog).toHaveBeenCalledTimes(1);
  });

  it("fresh (nothing ran) → not logged", async () => {
    vCred.mockResolvedValue({ syncedAt: new Date(Date.now() - 60_000), lastValidationStatus: "valid" });
    expect((await (await post("mount")).json()).skipped).toBe("fresh");
    await runAfterTasks();
    expect(vLog).not.toHaveBeenCalled();
  });

  it("account already synced before this run → not logged (existing users never inflate step 3)", async () => {
    vCred.mockResolvedValue({ syncedAt: new Date(Date.now() - 3 * 3600_000), lastValidationStatus: "valid" });
    vRun.mockResolvedValue(OK);
    await post();
    await runAfterTasks();
    expect(vRun).toHaveBeenCalled();
    expect(vLog).not.toHaveBeenCalled();
  });

  it("no credential → not logged (a stray POST can't lock the family)", async () => {
    vCred.mockResolvedValue(null);
    vRun.mockResolvedValue({ ...OK, ok: false, status: "invalid_token" });
    await post();
    await runAfterTasks();
    expect(vLog).not.toHaveBeenCalled();
  });
});
