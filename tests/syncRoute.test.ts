// /api/sync route behaviour: the "nothing ran" (skip) response shape, the
// stale-but-broken echo, and in-flight coalescing (T2 revision, 2026-09-21).
import { describe, it, expect, vi, beforeEach } from "vitest";

// `after()` needs a live request scope; here it just needs to not throw. Its
// callback is invoked so the run's own settle path still executes in tests.
vi.mock("next/server", async (importOriginal) => {
  const real = await importOriginal<typeof import("next/server")>();
  return { ...real, after: vi.fn((task: unknown) => (typeof task === "function" ? task() : task)) };
});
vi.mock("@/lib/access", () => ({ requireActiveUser: vi.fn() })); // #119: sync is a data route → gated
vi.mock("@/lib/prisma", () => ({ prisma: { canvasCredential: { findUnique: vi.fn() } } }));
vi.mock("@/lib/sync", () => ({ runSync: vi.fn() }));

import { requireActiveUser } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { runSync } from "@/lib/sync";
import { POST } from "@/app/api/sync/route";

type Fn = ReturnType<typeof vi.fn>;
const vUser = requireActiveUser as unknown as Fn;
const vCred = prisma.canvasCredential.findUnique as unknown as Fn;
const vRun = runSync as unknown as Fn;

let nextUserId = 100; // a fresh user per test → the module-scope maps start empty
const post = (body: unknown) =>
  POST(new Request("http://x/api/sync", { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  nextUserId++;
  vUser.mockResolvedValue({ id: nextUserId });
});

describe("skip response", () => {
  it("mount on a fresh account → 200 skipped:'fresh', 'Up to date.', no runSync", async () => {
    const syncedAt = new Date(Date.now() - 60_000);
    vCred.mockResolvedValue({ syncedAt, lastValidationStatus: "valid" });
    const res = await post({ trigger: "mount" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "valid", message: "Up to date.", syncedAt: syncedAt.toISOString(), failedCourses: [], skipped: "fresh" });
    expect(vRun).not.toHaveBeenCalled();
  });
  it("E: fresh-but-broken connection is NOT 'Up to date' — echoes the stored status", async () => {
    vCred.mockResolvedValue({ syncedAt: new Date(Date.now() - 60_000), lastValidationStatus: "invalid_token" });
    const body = await (await post({ trigger: "mount" })).json();
    expect(body.ok).toBe(false);
    expect(body.status).toBe("invalid_token");
    expect(body.skipped).toBe("fresh");
    expect(body.message).toMatch(/token was rejected/);
    expect(vRun).not.toHaveBeenCalled();
  });
  it("no body → manual → full run even when fresh", async () => {
    vCred.mockResolvedValue({ syncedAt: new Date(), lastValidationStatus: "valid" });
    vRun.mockResolvedValue({ ok: true, status: "valid", message: "Sync complete.", syncedAt: null, failedCourses: [], mode: "full" });
    const body = await (await post(undefined)).json();
    expect(vRun).toHaveBeenCalledWith(nextUserId, { mode: "full" });
    expect(body.mode).toBe("full");
    expect(body.skipped).toBeUndefined();
  });
  it("unauthenticated → 401", async () => {
    vUser.mockResolvedValue(null);
    expect((await post({ trigger: "mount" })).status).toBe(401);
  });
});

describe("in-flight coalescing", () => {
  const stale = new Date(Date.now() - 60 * 60_000);
  it("two overlapping full requests share one run; the joiner is tagged in_flight", async () => {
    vCred.mockResolvedValue({ syncedAt: stale, lastValidationStatus: "valid" });
    let resolve!: (r: unknown) => void;
    vRun.mockReturnValue(new Promise((r) => (resolve = r)));
    const p1 = post({ trigger: "mount" });
    await new Promise((r) => setTimeout(r, 0));
    const p2 = post({ trigger: "manual" });
    await new Promise((r) => setTimeout(r, 0));
    expect(vRun).toHaveBeenCalledTimes(1);
    resolve({ ok: true, status: "valid", message: "Sync complete.", syncedAt: "x", failedCourses: [], mode: "full" });
    const [b1, b2] = await Promise.all([p1.then((r) => r.json()), p2.then((r) => r.json())]);
    expect(b1.skipped).toBeUndefined();
    expect(b2.skipped).toBe("in_flight");
    expect(b2.mode).toBe("full");
  });
  it("a manual/full request does NOT join an in-flight quick run — it starts its own full run", async () => {
    vCred.mockResolvedValue({ syncedAt: stale, lastValidationStatus: "valid" });
    let resolveQuick!: (r: unknown) => void;
    vRun.mockReturnValueOnce(new Promise((r) => (resolveQuick = r)));
    vRun.mockResolvedValueOnce({ ok: true, status: "valid", message: "Sync complete.", syncedAt: "y", failedCourses: [], mode: "full" });
    const pq = post({ trigger: "focus" });
    await new Promise((r) => setTimeout(r, 0));
    const bf = await (await post({ trigger: "manual" })).json();
    expect(vRun).toHaveBeenCalledTimes(2);
    expect(vRun).toHaveBeenNthCalledWith(1, nextUserId, { mode: "quick" });
    expect(vRun).toHaveBeenNthCalledWith(2, nextUserId, { mode: "full" });
    expect(bf.skipped).toBeUndefined();
    resolveQuick({ ok: true, status: "valid", message: "Refreshed submissions.", syncedAt: null, failedCourses: [], mode: "quick" });
    expect((await (await pq).json()).mode).toBe("quick");
  });
  it("a thrown runSync becomes an error result (never an unhandled rejection / 500)", async () => {
    vCred.mockResolvedValue({ syncedAt: stale, lastValidationStatus: "valid" });
    vRun.mockRejectedValue(new Error("boom"));
    const res = await post({ trigger: "manual" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false, status: "error", failedCourses: [], mode: "full" });
  });
  it("8: an OLD run settling after its stale entry was replaced does not evict the NEW entry", async () => {
    vi.useFakeTimers();
    try {
      vCred.mockResolvedValue({ syncedAt: stale, lastValidationStatus: "valid" });
      let resolveOld!: (r: unknown) => void;
      let resolveNew!: (r: unknown) => void;
      vRun.mockReturnValueOnce(new Promise((r) => (resolveOld = r)));
      vRun.mockReturnValueOnce(new Promise((r) => (resolveNew = r)));
      const pOld = post({ trigger: "manual" });
      await vi.advanceTimersByTimeAsync(50_000); // old request answers with the timeout
      expect((await (await pOld).json()).skipped).toBe("timeout");
      await vi.advanceTimersByTimeAsync(6_000); // entry now stale → replaced by a new run
      const pNew = post({ trigger: "manual" });
      await vi.advanceTimersByTimeAsync(0);
      expect(vRun).toHaveBeenCalledTimes(2);
      // the OLD run settles late; its finally must NOT delete the new entry...
      resolveOld({ ok: true, status: "valid", message: "old", syncedAt: "old", failedCourses: [], mode: "full" });
      await vi.advanceTimersByTimeAsync(0);
      // ...so a third request still JOINS the new run instead of starting another
      const pJoin = post({ trigger: "manual" });
      await vi.advanceTimersByTimeAsync(0);
      expect(vRun).toHaveBeenCalledTimes(2);
      resolveNew({ ok: true, status: "valid", message: "new", syncedAt: "new", failedCourses: [], mode: "full" });
      const [bNew, bJoin] = await Promise.all([pNew.then((r) => r.json()), pJoin.then((r) => r.json())]);
      expect(bNew.syncedAt).toBe("new");
      expect(bJoin).toMatchObject({ syncedAt: "new", skipped: "in_flight" });
    } finally {
      vi.useRealTimers();
    }
  });
  it("B: the route answers by its own deadline while the run keeps going", async () => {
    vi.useFakeTimers();
    try {
      vCred.mockResolvedValue({ syncedAt: stale, lastValidationStatus: "valid" });
      vRun.mockReturnValue(new Promise(() => {})); // never settles (a killed run)
      const p = post({ trigger: "manual" });
      await vi.advanceTimersByTimeAsync(50_000);
      const body = await (await p).json();
      expect(body).toMatchObject({ ok: false, status: "unreachable", message: "Canvas is taking longer than usual — showing the last good data.", skipped: "timeout" });
      // 56s later the entry is stale: a new request replaces it instead of hanging
      await vi.advanceTimersByTimeAsync(6_000);
      vRun.mockResolvedValueOnce({ ok: true, status: "valid", message: "Sync complete.", syncedAt: "z", failedCourses: [], mode: "full" });
      const p2 = post({ trigger: "manual" });
      await vi.advanceTimersByTimeAsync(0);
      expect(vRun).toHaveBeenCalledTimes(2);
      expect((await (await p2).json()).syncedAt).toBe("z");
    } finally {
      vi.useRealTimers();
    }
  });
});
