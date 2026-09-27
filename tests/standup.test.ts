// Ticket #46 — admin standup log: pure helpers, the route (mocked prisma + auth)
// and source guards (gating, awaited writes, nav entry, 16px phone inputs).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() })); // what lib/admin's getAdminUser reads
vi.mock("@/lib/prisma", () => ({ prisma: { standupEntry: { findMany: vi.fn(), upsert: vi.fn() } } }));

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { GET, POST } from "@/app/api/admin/standup/route";
import { ymd } from "@/lib/calendarDates";
import {
  parseStandupBody,
  groupByDate,
  formatStandupDay,
  upsertEntryInList,
  STANDUP_MAX_CHARS,
  type StandupEntryDto,
} from "@/lib/standup";
import { adminItems } from "@/components/navItems";
import { NAV_ICONS } from "@/components/navIcons";

const read = (p: string) => readFileSync(p, "utf8");
const NOW = new Date(2026, 8, 26, 12, 0); // local noon, Sat Sep 26 2026
const parse = (json: unknown) => parseStandupBody(json, NOW);
const valid = { date: "2026-09-26", yesterday: " shipped #39 ", today: "standup page", blockers: "" };

describe("parseStandupBody", () => {
  it("accepts a valid body, trims, and turns blank blockers into null", () => {
    expect(parse(valid)).toEqual({
      ok: true,
      value: { date: "2026-09-26", yesterday: "shipped #39", today: "standup page", blockers: null },
    });
  });
  it("keeps non-empty blockers (trimmed)", () => {
    const r = parse({ ...valid, blockers: "  waiting on DNS " });
    expect(r.ok && r.value.blockers).toBe("waiting on DNS");
  });
  it("blockers may be omitted entirely", () => {
    const { blockers: _b, ...rest } = valid;
    expect(parse(rest).ok).toBe(true);
  });
  it("rejects a missing today", () => {
    const { today: _t, ...rest } = valid;
    const r = parse(rest);
    expect(r.ok).toBe(false);
  });
  it("rejects whitespace-only yesterday/today", () => {
    expect(parse({ ...valid, yesterday: "   \n " }).ok).toBe(false);
    expect(parse({ ...valid, today: "\t" }).ok).toBe(false);
  });
  it("rejects bad dates (format and impossible days)", () => {
    for (const date of ["2026-9-26", "26-09-2026", "2026-02-30", "2026-13-01", "", undefined, 20260926]) {
      expect(parse({ ...valid, date }).ok).toBe(false);
    }
    expect(parseStandupBody({ ...valid, date: "2028-02-29" }, new Date(2028, 1, 29, 12)).ok).toBe(true); // leap day
  });
  it("accepts dates within ±1 day of the server's day, rejects anything further", () => {
    for (const date of ["2026-09-25", "2026-09-26", "2026-09-27"]) expect(parse({ ...valid, date }).ok).toBe(true);
    for (const date of ["2026-09-24", "2026-09-28", "2025-09-26"]) expect(parse({ ...valid, date }).ok).toBe(false);
  });
  it("rejects any field over the max length (and accepts exactly the max)", () => {
    const long = "x".repeat(STANDUP_MAX_CHARS + 1);
    expect(parse({ ...valid, yesterday: long }).ok).toBe(false);
    expect(parse({ ...valid, today: long }).ok).toBe(false);
    expect(parse({ ...valid, blockers: long }).ok).toBe(false);
    expect(parse({ ...valid, today: "x".repeat(STANDUP_MAX_CHARS) }).ok).toBe(true);
  });
  it("rejects non-object bodies and non-string fields", () => {
    expect(parse(null).ok).toBe(false);
    expect(parse("hi").ok).toBe(false);
    expect(parse({ ...valid, today: 42 }).ok).toBe(false);
  });
});

describe("groupByDate", () => {
  const e = (id: number, date: string, author: string) => ({ id, date, author });
  it("groups newest day first, entries in author order within a day", () => {
    const out = groupByDate([
      e(1, "2026-09-24", "Peyton"),
      e(2, "2026-09-26", "Peyton"),
      e(3, "2026-09-26", "Calvin"),
      e(4, "2026-09-25", "Calvin"),
    ]);
    expect(out.map((d) => d.date)).toEqual(["2026-09-26", "2026-09-25", "2026-09-24"]);
    expect(out[0].entries.map((x) => x.author)).toEqual(["Calvin", "Peyton"]);
  });
  it("empty in → empty out", () => {
    expect(groupByDate([])).toEqual([]);
  });
});

describe("date helpers", () => {
  it("formatStandupDay renders weekday, Month D", () => {
    expect(formatStandupDay("2026-09-26")).toBe("Saturday, September 26");
  });
  it("upsertEntryInList replaces by id or prepends", () => {
    const base: StandupEntryDto = {
      id: 1, date: "2026-09-26", author: "Calvin", authorId: 7, yesterday: "a", today: "b", blockers: null, updatedAt: "",
    };
    expect(upsertEntryInList([base], { ...base, today: "c" })).toEqual([{ ...base, today: "c" }]);
    expect(upsertEntryInList([base], { ...base, id: 2 }).map((x) => x.id)).toEqual([2, 1]);
  });
});

type Fn = ReturnType<typeof vi.fn>;
const vUser = getCurrentUser as unknown as Fn;
const vFindMany = prisma.standupEntry.findMany as unknown as Fn;
const vUpsert = prisma.standupEntry.upsert as unknown as Fn;
const ADMIN = { id: 7, email: "calvin@example.com", fullName: "Calvin", isAdmin: true };
const STUDENT = { id: 9, email: "student@example.com", fullName: "Stu", isAdmin: false };
const row = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 1, date: ymd(new Date()), author: "Calvin", authorId: 7, yesterday: "a", today: "b", blockers: null,
  updatedAt: new Date("2026-09-26T12:00:00Z"), ...over,
});
const post = (body: unknown) =>
  POST(new Request("http://x/api/admin/standup", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }), undefined);
const get = () => GET(new Request("http://x/api/admin/standup"), undefined);

describe("route /api/admin/standup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vUser.mockResolvedValue(ADMIN);
  });

  it("non-admin → 404 on GET and POST, and no DB work", async () => {
    vUser.mockResolvedValue(STUDENT);
    expect((await get()).status).toBe(404);
    expect((await post({ date: ymd(new Date()), yesterday: "a", today: "b" })).status).toBe(404);
    vUser.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    expect(vFindMany).not.toHaveBeenCalled();
    expect(vUpsert).not.toHaveBeenCalled();
  });

  it("GET returns entries (ISO dates) + me", async () => {
    vFindMany.mockResolvedValue([row()]);
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.me).toEqual({ name: "Calvin", id: 7 });
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].updatedAt).toBe("2026-09-26T12:00:00.000Z");
    expect(vFindMany.mock.calls[0][0].orderBy[0]).toEqual({ date: "desc" });
  });

  it("POST upserts MY entry on date_authorId with the caller's id", async () => {
    const date = ymd(new Date());
    vUpsert.mockResolvedValue(row({ date, today: "ship #46" }));
    const res = await post({ date, yesterday: " review ", today: "ship #46", blockers: "" });
    expect(res.status).toBe(200);
    expect((await res.json()).entry.today).toBe("ship #46");
    const args = vUpsert.mock.calls[0][0];
    expect(args.where).toEqual({ date_authorId: { date, authorId: 7 } });
    expect(args.create).toMatchObject({ date, authorId: 7, author: "Calvin", yesterday: "review", blockers: null });
    expect(args.update).toMatchObject({ author: "Calvin", today: "ship #46" });
    expect(args.update.authorId).toBeUndefined();
  });

  it("invalid body → 400 with an error, no write", async () => {
    for (const body of ["not json", { date: ymd(new Date()), yesterday: "a", today: "  " }, { date: "2020-01-01", yesterday: "a", today: "b" }]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(typeof (await res.json()).error).toBe("string");
    }
    expect(vUpsert).not.toHaveBeenCalled();
  });
});

describe("source guards", () => {
  const page = read("app/(app)/admin/standup/page.tsx");
  const route = read("app/api/admin/standup/route.ts");
  const ui = read("components/StandupLog.tsx");

  it("page re-runs requirePageAccess and the admin check (getAdminUser → notFound)", () => {
    expect(page.includes("await requirePageAccess()")).toBe(true);
    expect(page.includes("await getAdminUser()")).toBe(true);
    expect(page.includes("notFound()")).toBe(true);
  });
  it("page reads history via prisma (no client fetch on first paint)", () => {
    expect(page.includes("prisma.standupEntry.findMany(")).toBe(true);
  });
  it("route wraps GET and POST in withAdmin", () => {
    expect(route.includes("export const GET = withAdmin(")).toBe(true);
    expect(route.includes("export const POST = withAdmin(")).toBe(true);
  });
  it("route awaits every prisma call and never voids work", () => {
    const calls = [...route.matchAll(/prisma\.standupEntry\.\w+\(/g)];
    expect(calls.length).toBe(2); // findMany, upsert
    for (const m of calls) expect(route.slice(Math.max(0, m.index! - 6), m.index)).toBe("await ");
    expect(/\bvoid\s+prisma/.test(route)).toBe(false);
  });
  it("client uses useLocalToday (the ONE local-day correction) and re-checks the day at submit", () => {
    expect(ui.includes("useLocalToday(serverToday)")).toBe(true);
    expect(ui.includes('addEventListener("visibilitychange"')).toBe(true);
    expect(/async function save[\s\S]*?ymd\(new Date\(\)\)[\s\S]*?fetch\(/.test(ui)).toBe(true);
  });
  it("phones reach every admin page: AccountSheet maps all adminItems", () => {
    const sheet = read("components/AccountSheet.tsx");
    expect(sheet.includes("adminItems.map(")).toBe(true);
    expect(sheet.includes("adminItems[0]")).toBe(false);
  });
  it("schema enforces one entry per author per day", () => {
    const model = read("prisma/schema.prisma").match(/model StandupEntry \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(model.includes("@@unique([date, authorId])")).toBe(true);
  });
  it("adminItems has the /admin/standup entry with a real icon", () => {
    const item = adminItems.find((i) => i.href === "/admin/standup");
    expect(item?.label).toBe("Standup");
    expect(NAV_ICONS[item!.icon]).toBeTypeOf("string");
  });
  it("textareas get 16px on phones via the global <md rule (no iOS zoom)", () => {
    expect(ui.match(/<textarea/g)?.length).toBe(3);
    expect(/@media \(max-width: 767px\)\s*\{[^}]*textarea[^}]*font-size:\s*16px/.test(read("app/globals.css"))).toBe(true);
  });
  it("save button is a 44px phone target and the result line is a status region", () => {
    expect(ui.includes('className="btn-primary max-md:tap"')).toBe(true);
    expect(ui.includes('role="status"')).toBe(true);
  });
  it("no raw hex colours in the new UI", () => {
    expect(/#[0-9a-fA-F]{3,8}\b/.test(ui)).toBe(false);
  });
});
