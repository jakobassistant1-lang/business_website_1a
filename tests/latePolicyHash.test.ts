// #126: the late-policy Gemini read is hash short-circuited like the assignment
// analysis — a sync whose syllabi are unchanged makes ZERO late-policy calls, and
// the hash is stored only alongside a successfully parsed policy (a failure
// stores nothing, so the next sync retries).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    canvasCredential: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) }, // updateMany = the #132 sync-report write
    course: { findMany: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    assignment: { upsert: vi.fn() },
    announcement: { upsert: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import * as latePolicy from "@/lib/latePolicy";
import { syllabusHash, latePolicyWorkToDo, parseLatePolicies, MAX_SYLLABUS_CHARS } from "@/lib/latePolicy";
import { runSync } from "@/lib/sync";

describe("syllabusHash — fingerprint of the text the prompt actually sees", () => {
  it("is a sha256 hex digest and deterministic", () => {
    expect(syllabusHash("Late work loses 10% per day.")).toMatch(/^[0-9a-f]{64}$/);
    expect(syllabusHash("Late work loses 10% per day.")).toBe(syllabusHash("Late work loses 10% per day."));
  });
  it("HTML / whitespace noise doesn't change it (same stripped text → same hash)", () => {
    const plain = "Late work loses 10% per day.";
    expect(syllabusHash("<p>Late work loses <b>10%</b> per day.</p>")).toBe(syllabusHash(plain));
    expect(syllabusHash("  Late   work\nloses 10%\tper day.  ")).toBe(syllabusHash(plain));
  });
  it("different policy text → different hash", () => {
    expect(syllabusHash("Late work loses 10% per day.")).not.toBe(syllabusHash("Late work is not accepted."));
  });
  it("empty / tag-only syllabus hashes the empty string (stable, never re-asked)", () => {
    expect(syllabusHash("")).toBe(syllabusHash("<p> </p>"));
    expect(syllabusHash("")).toMatch(/^[0-9a-f]{64}$/);
  });
  it("is tagged with LATE_POLICY_VERSION (a prompt change re-parses stored policies)", async () => {
    const { createHash } = await import("crypto");
    expect(syllabusHash("x")).toBe(createHash("sha256").update(`v${latePolicy.LATE_POLICY_VERSION}\u0000x`).digest("hex"));
    expect(syllabusHash("x")).not.toBe(createHash("sha256").update("x").digest("hex"));
  });
  it("text past the prompt's cut-off doesn't bust the cache", () => {
    const head = "x".repeat(MAX_SYLLABUS_CHARS);
    expect(syllabusHash(head + " appendix A")).toBe(syllabusHash(head + " appendix B"));
  });
});

describe("parseLatePolicies — a garbled kind is not an answer", () => {
  it("valid id + unknown kind → left out (no policy, no hash → retried next sync)", () => {
    const inputs = [
      { courseId: 1, courseName: "Micro", syllabus: "10% per day" },
      { courseId: 2, courseName: "Finance", syllabus: "No late work." },
    ];
    const text = JSON.stringify([{ id: 1, kind: "per-day-ish", value: 0.1 }, { id: 2, kind: "none", value: 0 }]);
    const out = parseLatePolicies({ candidates: [{ content: { parts: [{ text }] } }] }, inputs);
    expect(out).toEqual([{ courseId: 2, policy: { kind: "none", value: 0 } }]);
  });
});

describe("latePolicyWorkToDo — only changed syllabi go to Gemini", () => {
  const a = { courseId: 1, courseName: "Micro", syllabus: "<p>10% per day</p>" };
  const b = { courseId: 2, courseName: "Finance", syllabus: "No late work." };

  it("unchanged → nothing to parse", () => {
    const r = latePolicyWorkToDo([{ ...a, storedHash: syllabusHash(a.syllabus) }]);
    expect(r.toParse).toEqual([]);
    expect(r.hashes.size).toBe(0);
  });
  it("changed → 1, with the NEW hash ready to store", () => {
    const r = latePolicyWorkToDo([{ ...a, storedHash: syllabusHash("old text") }]);
    expect(r.toParse).toEqual([a]); // storedHash is not forwarded to the prompt input
    expect(r.hashes.get(1)).toBe(syllabusHash(a.syllabus));
  });
  it("missing stored hash (never parsed / pre-#126 row) → 1", () => {
    const r = latePolicyWorkToDo([{ ...a, storedHash: null }]);
    expect(r.toParse).toEqual([a]);
  });
  it("mixed → only the changed ones", () => {
    const r = latePolicyWorkToDo([
      { ...a, storedHash: syllabusHash(a.syllabus) },
      { ...b, storedHash: null },
    ]);
    expect(r.toParse).toEqual([b]);
    expect([...r.hashes.keys()]).toEqual([2]);
  });
});

// --- behaviour: two real runSync calls against stubbed Canvas + prisma ---------
type Fn = ReturnType<typeof vi.fn>;
const credFind = prisma.canvasCredential.findUnique as unknown as Fn;
const credUpdate = prisma.canvasCredential.update as unknown as Fn;
const courseUpsert = prisma.course.upsert as unknown as Fn;
const courseUpdate = prisma.course.update as unknown as Fn;
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("runSync: second sync with unchanged syllabi makes ZERO late-policy Gemini calls", () => {
  const SYLLABUS = "<p>Late work loses 10% per day.</p>";
  // A tiny in-memory Course table: upsert returns the row (with its stored hash),
  // update merges the written fields — what Prisma does for real.
  let rows: Map<number, Record<string, unknown>>;

  beforeEach(() => {
    vi.clearAllMocks();
    rows = new Map();
    credFind.mockResolvedValue({ userId: 1, host: "canvas.test", token: "raw-token", syncedAt: null });
    credUpdate.mockResolvedValue({});
    courseUpsert.mockImplementation(async ({ where }: { where: { userId_canvasId: { canvasId: number } } }) => {
      const id = 1000 + where.userId_canvasId.canvasId;
      if (!rows.has(id)) rows.set(id, { id, latePolicyHash: null });
      return { ...rows.get(id) };
    });
    courseUpdate.mockImplementation(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
      rows.set(where.id, { ...rows.get(where.id), ...data });
      return rows.get(where.id);
    });
    (prisma.assignment.upsert as unknown as Fn).mockResolvedValue({});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (/users\/self/.test(url)) return json({ name: "Calvin" });
        if (/\/courses\?/.test(url)) return json([{ id: 101, name: "Micro", enrollments: [{ type: "student" }] }]);
        if (/courses\/101\?include\[\]=syllabus_body/.test(url)) return json({ syllabus_body: SYLLABUS });
        return json([]);
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("first sync parses + stores kind/value/hash; second sync sends nothing", async () => {
    const spy = vi
      .spyOn(latePolicy, "analyzeLatePolicies")
      .mockResolvedValue({ ok: true, source: "gemini", items: [{ courseId: 101, policy: { kind: "perday", value: 0.1 } }] });

    await runSync(1, { mode: "full" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(rows.get(1101)).toMatchObject({ latePolicyKind: "perday", latePolicyValue: 0.1, latePolicyHash: syllabusHash(SYLLABUS) });

    await runSync(1, { mode: "full" });
    expect(spy).toHaveBeenCalledTimes(1); // ← zero new late-policy Gemini calls
    expect(rows.get(1101)).toMatchObject({ latePolicyKind: "perday", latePolicyValue: 0.1 }); // stored policy untouched
  });

  it("Gemini answers ok but omits the course → no hash written, re-asked next sync", async () => {
    const spy = vi.spyOn(latePolicy, "analyzeLatePolicies").mockResolvedValue({ ok: true, source: "gemini", items: [] });

    await runSync(1, { mode: "full" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(courseUpdate).not.toHaveBeenCalled();
    expect(rows.get(1101)?.latePolicyHash).toBeNull();

    await runSync(1, { mode: "full" });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("a Gemini failure stores NOTHING, so the next sync retries", async () => {
    const spy = vi.spyOn(latePolicy, "analyzeLatePolicies").mockResolvedValue({ ok: false, reason: "timeout" });

    await runSync(1, { mode: "full" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(courseUpdate).not.toHaveBeenCalled();
    expect(rows.get(1101)?.latePolicyHash).toBeNull();

    await runSync(1, { mode: "full" });
    expect(spy).toHaveBeenCalledTimes(2); // retried
  });
});
