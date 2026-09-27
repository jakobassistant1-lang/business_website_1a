// #111: "first" milestones (first_sync_ok/failed, first_plan_rendered) fire at
// most once per user per family, never throw, and are awaited at their call sites.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("../lib/prisma", () => ({ prisma: {} }));

import { logFirst, inFirstsCohort, FUNNEL_FIRSTS_SINCE } from "../lib/funnel";

type Row = { userId: number | null; name: string; meta: string | null };

function fakeClient() {
  const rows: Row[] = [];
  const client = {
    rows,
    funnelEvent: {
      async findFirst(args: { where: { userId: number; name: { in: string[] } } }) {
        const hit = rows.find((r) => r.userId === args.where.userId && args.where.name.in.includes(r.name));
        return hit ? { id: 1 } : null;
      },
      async create(args: { data: Row }) {
        rows.push(args.data);
        return args.data;
      },
    },
  };
  return client;
}

describe("logFirst (#111)", () => {
  it("fires once; a second call in the same family is a no-op", async () => {
    const c = fakeClient();
    await logFirst("first_plan_rendered", 7, { items: 3 }, c);
    await logFirst("first_plan_rendered", 7, { items: 9 }, c);
    expect(c.rows).toEqual([{ userId: 7, name: "first_plan_rendered", meta: JSON.stringify({ items: 3 }) }]);
  });

  it("first_sync_ok and first_sync_failed share one family", async () => {
    const c = fakeClient();
    await logFirst("first_sync_failed", 7, { status: "error" }, c);
    await logFirst("first_sync_ok", 7, undefined, c);
    await logFirst("first_sync_failed", 7, undefined, c);
    expect(c.rows.map((r) => r.name)).toEqual(["first_sync_failed"]);
  });

  it("families and users are independent", async () => {
    const c = fakeClient();
    await logFirst("first_sync_ok", 7, undefined, c);
    await logFirst("first_plan_rendered", 7, undefined, c);
    await logFirst("first_sync_ok", 8, undefined, c);
    expect(c.rows.map((r) => `${r.userId}:${r.name}`)).toEqual(["7:first_sync_ok", "7:first_plan_rendered", "8:first_sync_ok"]);
  });

  it("never throws when the client throws (lookup or insert)", async () => {
    const boom = () => Promise.reject(new Error("db down"));
    await expect(logFirst("first_sync_ok", 1, undefined, { funnelEvent: { findFirst: boom, create: boom } })).resolves.toBeUndefined();
    const create = vi.fn(boom);
    await expect(logFirst("first_sync_ok", 1, undefined, { funnelEvent: { findFirst: async () => null, create } })).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledOnce();
  });

  it("skips the insert when the lookup fails (no risk of a duplicate)", async () => {
    const create = vi.fn(async () => ({}));
    await logFirst("first_plan_rendered", 1, undefined, { funnelEvent: { findFirst: () => Promise.reject(new Error("x")), create } });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("inFirstsCohort (#111)", () => {
  it("only users created on/after the ship date (UTC) are in the cohort", () => {
    expect(FUNNEL_FIRSTS_SINCE).toBe("2026-09-27");
    expect(inFirstsCohort(new Date("2026-09-26T23:59:59Z"))).toBe(false);
    expect(inFirstsCohort(new Date("2026-09-27T00:00:00Z"))).toBe(true);
    expect(inFirstsCohort(new Date("2027-01-01T00:00:00Z"))).toBe(true);
  });
});

describe("first-milestone call sites are awaited and gated (#111)", () => {
  const ROOT = join(__dirname, "..");
  const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

  it("sync route: inline log is awaited, only for an in-time answer; after() logs the owned run", () => {
    const src = read("app/api/sync/route.ts");
    expect(src).toMatch(/if \(!result\.skipped\) await logFirstSync\(result\);/);
    expect(src).toMatch(/after\(\(\) => entry\.promise\.then\(logFirstSync\)\)/);
    expect(src).toMatch(/const isFirstSync = cred != null && cred\.syncedAt == null;/);
    expect(src).not.toMatch(/\bvoid\s+(logFirst|logFirstSync)\(/);
  });

  it("dashboard page awaits logFirst, gated on a completed sync and the new-user cohort", () => {
    const src = read("app/(app)/dashboard/page.tsx");
    expect(src).toMatch(/if \(data\.syncedAt && inFirstsCohort\(user\.createdAt\)\) \{\s*await logFirst\("first_plan_rendered"/);
    expect(src).not.toMatch(/\bvoid\s+logFirst\(/);
  });
});
