// #129 — the analyzer must DRAIN for a returning user with a big backlog, without
// burning the shared Gemini quota. Three independent pieces, tested apart:
//   1. the pure drain rule (shouldContinue) + the pending predicate it drains,
//   2. the route's per-user throttle (a runaway client is stopped server-side),
//   3. runAnalysis' counts + its zero-Gemini steady state,
//   4. grep guards that the client actually uses the shared cap and refreshes ONCE.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";

vi.mock("@/lib/access", () => ({ requireActiveUser: vi.fn() }));
vi.mock("@/lib/analysisStore", () => ({ runAnalysis: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { assignment: { findMany: vi.fn(), update: vi.fn() } },
}));
vi.mock("@/lib/settings", () => ({ getSetting: vi.fn(async () => null), ANALYSIS_PROMPT_KEY: "analysis_prompt" }));
// Keep the real parsing/URL helpers; stub only the network + key.
vi.mock("@/lib/geminiFetch", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/geminiFetch")>();
  return { ...real, geminiPost: vi.fn(), geminiKey: vi.fn(() => "test-key") };
});

// Imported through @/lib/analysis on purpose: server callers keep ONE import path,
// so this also proves the re-export of the dependency-free module still lands.
import {
  MAX_ANALYZE_ROUNDS,
  MAX_BATCH,
  shouldContinue,
  needsAnalysis,
  selectUnanalyzed,
  analysisInputHash,
  type AnalyzableRow,
} from "@/lib/analysis";
import * as analysisLoop from "@/lib/analysisLoop";
// The real shared limiter (#128) — not mocked: each test uses a FRESH user id, so
// the module-scope map is never shared between cases (same convention as its tests).
import { peekRateLimit } from "@/lib/rateLimit";
import { geminiPost } from "@/lib/geminiFetch";
import { prisma } from "@/lib/prisma";
import { requireActiveUser } from "@/lib/access";
import { runAnalysis as mockedRunAnalysis } from "@/lib/analysisStore";
import { POST } from "@/app/api/analyze/route";

type Fn = ReturnType<typeof vi.fn>;
const vUser = requireActiveUser as unknown as Fn;
const vRunAnalysis = mockedRunAnalysis as unknown as Fn;
const vGemini = geminiPost as unknown as Fn;
const vFindMany = prisma.assignment.findMany as unknown as Fn;
const vUpdate = prisma.assignment.update as unknown as Fn;

beforeEach(() => vi.clearAllMocks());

// --- 1. the pure drain rule ------------------------------------------------
describe("shouldContinue (the bounded drain)", () => {
  const more = { analyzed: 40, remaining: 110, done: false };
  it("keeps going while the server analyzed something and isn't done", () => {
    expect(shouldContinue(0, more)).toBe(true);
    expect(shouldContinue(4, more)).toBe(true);
  });
  it("stops at the cap — never more than MAX_ANALYZE_ROUNDS posts per visit", () => {
    expect(MAX_ANALYZE_ROUNDS).toBe(6);
    expect(shouldContinue(MAX_ANALYZE_ROUNDS - 1, more)).toBe(false);
    expect(shouldContinue(MAX_ANALYZE_ROUNDS, more)).toBe(false);
  });
  it("stops when the server says done, even with a stale non-zero analyzed", () => {
    expect(shouldContinue(0, { analyzed: 12, remaining: 0, done: true })).toBe(false);
  });
  it("stops when a round analyzed nothing (idle, AI down, or nothing left)", () => {
    expect(shouldContinue(0, { analyzed: 0, remaining: 0, done: true })).toBe(false);
    expect(shouldContinue(0, { analyzed: 0, remaining: 77, done: false })).toBe(false); // AI unavailable
  });
  it("stops on a throttle answer (429 body) — the client backs off, it doesn't retry", () => {
    expect(shouldContinue(0, { analyzed: 0, remaining: -1, done: true })).toBe(false);
  });
  it("stops on a null body: non-OK response or a thrown fetch → fail open", () => {
    expect(shouldContinue(0, null)).toBe(false);
  });
  it("ignores a body that isn't the declared shape (no spinning on junk JSON)", () => {
    expect(shouldContinue(0, {})).toBe(false);
    expect(shouldContinue(0, { analyzed: "40", done: false })).toBe(false);
  });
  it("a 150-assignment backlog drains inside one visit", () => {
    let left = 150;
    let rounds = 0;
    for (let round = 0; round < MAX_ANALYZE_ROUNDS; round++) {
      const analyzed = Math.min(MAX_BATCH, left);
      left -= analyzed;
      rounds++;
      if (!shouldContinue(round, { analyzed, remaining: left, done: left === 0 })) break;
    }
    expect(left).toBe(0);
    expect(rounds).toBe(4); // 40+40+40+30, then `done` ends it — well inside the cap
    expect(MAX_ANALYZE_ROUNDS * MAX_BATCH).toBe(240);
  });
});

// --- the predicate `remaining` is counted with ------------------------------
function row(over: Partial<AnalyzableRow> & { canvasId: number }): AnalyzableRow {
  return {
    name: `A${over.canvasId}`,
    courseName: "C",
    pointsPossible: 10,
    dueAt: null,
    description: null,
    analyzedAt: null,
    analysisHash: null,
    ...over,
  };
}
const analyzed = (id: number): AnalyzableRow => {
  const r = row({ canvasId: id });
  return { ...r, analyzedAt: new Date(), analysisHash: analysisInputHash(r) };
};

describe("pending predicate (one rule for selecting work AND counting what's left)", () => {
  it("never analyzed → pending; analyzed with a matching hash → not pending", () => {
    expect(needsAnalysis(row({ canvasId: 1 }))).toBe(true);
    expect(needsAnalysis(analyzed(2))).toBe(false);
  });
  it("content changed after analysis → pending again (stale hash)", () => {
    expect(needsAnalysis({ ...analyzed(3), name: "renamed" })).toBe(true);
  });
  it("selectUnanalyzed is exactly the rows needsAnalysis keeps", () => {
    const rows = [row({ canvasId: 1 }), analyzed(2), { ...analyzed(3), pointsPossible: 99 }];
    expect(selectUnanalyzed(rows).map((r) => r.canvasId)).toEqual([1, 3]);
    expect(selectUnanalyzed(rows).length).toBe(rows.filter(needsAnalysis).length);
  });
});

// --- 2. the route's per-user throttle ---------------------------------------
let nextUserId = 900; // a fresh user per test → the module-scope map starts empty
const ANALYZE_RATE = { limit: 8, windowMs: 60_000 };
describe("POST /api/analyze throttle (a runaway client can't burn the quota)", () => {
  beforeEach(() => {
    nextUserId++;
    vUser.mockResolvedValue({ id: nextUserId });
    vRunAnalysis.mockResolvedValue({ analyzed: 1, skipped: 0, ok: true, remaining: 5, done: false });
  });
  it("passes through the store's counts on a normal call", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ analyzed: 1, skipped: 0, ok: true, remaining: 5, done: false });
    expect(vRunAnalysis).toHaveBeenCalledWith(nextUserId);
  });
  it("allows 8 calls a minute, then 429s with a body that stops the client", async () => {
    for (let i = 0; i < 8; i++) expect((await POST()).status).toBe(200);
    const res = await POST();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ analyzed: 0, remaining: -1, done: true });
    expect(shouldContinue(0, await (await POST()).json())).toBe(false); // client stops
    expect(vRunAnalysis).toHaveBeenCalledTimes(8); // no extra Gemini work
  });
  it("spends the SHARED limiter's 'analyze' bucket, keyed by user id", () => {
    const key = String(nextUserId);
    expect(peekRateLimit("analyze", key, ANALYZE_RATE).allowed).toBe(true); // fresh user
    return (async () => {
      for (let i = 0; i < 8; i++) await POST();
      // The route's own key is now exhausted in that bucket — proof it called the
      // shared limiter with ("analyze", user.id) and not a private map.
      expect(peekRateLimit("analyze", key, ANALYZE_RATE).allowed).toBe(false);
      expect(peekRateLimit("login", key, ANALYZE_RATE).allowed).toBe(true); // auth budget untouched
    })();
  });
  it("the budget is per user — one runaway client doesn't block anybody else", async () => {
    for (let i = 0; i < 9; i++) await POST();
    vUser.mockResolvedValue({ id: ++nextUserId });
    expect((await POST()).status).toBe(200);
  });
  it("the window rolls: a minute later the same user is served again", async () => {
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 8; i++) await POST();
      expect((await POST()).status).toBe(429);
      await vi.advanceTimersByTimeAsync(61_000);
      expect((await POST()).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });
  it("the cap sits above the client's own cap, so an honest visit is never cut short", async () => {
    for (let i = 0; i < MAX_ANALYZE_ROUNDS; i++) expect((await POST()).status).toBe(200);
  });
  it("unauthenticated → 401, and no analysis", async () => {
    vUser.mockResolvedValue(null);
    expect((await POST()).status).toBe(401);
    expect(vRunAnalysis).not.toHaveBeenCalled();
  });
});

// --- 3. runAnalysis: counts + the zero-Gemini steady state ------------------
function dbRow(r: AnalyzableRow) {
  return {
    canvasId: r.canvasId,
    name: r.name,
    course: { name: r.courseName },
    pointsPossible: r.pointsPossible,
    dueAt: null,
    description: r.description,
    analyzedAt: r.analyzedAt,
    analysisHash: r.analysisHash,
  };
}
function geminiAnswers(ids: number[]) {
  const text = JSON.stringify(ids.map((id) => ({ id, hours: 2, bucket: "medium", summary: "s", importance: 3, requiresAction: true })));
  return { res: { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) }, timedOut: false };
}

describe("runAnalysis counts (the real store, mocked prisma + Gemini)", () => {
  it("steady state: nothing pending → one cheap call, ZERO Gemini calls", async () => {
    const { runAnalysis } = await vi.importActual<typeof import("@/lib/analysisStore")>("@/lib/analysisStore");
    vFindMany.mockResolvedValue([analyzed(1), analyzed(2)].map(dbRow));
    expect(await runAnalysis(7)).toEqual({ analyzed: 0, skipped: 2, ok: true, remaining: 0, done: true });
    expect(vGemini).not.toHaveBeenCalled();
    expect(vUpdate).not.toHaveBeenCalled();
  });
  it("a backlog bigger than one batch reports what's LEFT, so the client loops", async () => {
    const { runAnalysis } = await vi.importActual<typeof import("@/lib/analysisStore")>("@/lib/analysisStore");
    const rows = Array.from({ length: 45 }, (_, i) => row({ canvasId: i + 1 }));
    vFindMany.mockResolvedValue(rows.map(dbRow));
    vUpdate.mockResolvedValue({});
    vGemini.mockResolvedValue(geminiAnswers(rows.slice(0, MAX_BATCH).map((r) => r.canvasId)));
    const res = await runAnalysis(7);
    expect(vGemini).toHaveBeenCalledTimes(1);
    expect(res.analyzed).toBe(MAX_BATCH);
    expect(res.remaining).toBe(5);
    expect(res.done).toBe(false);
  });
  it("the last batch answers done, so the drain ends", async () => {
    const { runAnalysis } = await vi.importActual<typeof import("@/lib/analysisStore")>("@/lib/analysisStore");
    const rows = [row({ canvasId: 1 }), row({ canvasId: 2 }), analyzed(3)];
    vFindMany.mockResolvedValue(rows.map(dbRow));
    vUpdate.mockResolvedValue({});
    vGemini.mockResolvedValue(geminiAnswers([1, 2]));
    const res = await runAnalysis(7);
    expect(res).toMatchObject({ analyzed: 2, ok: true, remaining: 0, done: true });
    expect(shouldContinue(0, res)).toBe(false);
  });
  it("rows the model skipped stay in `remaining` — the count never lies", async () => {
    const { runAnalysis } = await vi.importActual<typeof import("@/lib/analysisStore")>("@/lib/analysisStore");
    vFindMany.mockResolvedValue([row({ canvasId: 1 }), row({ canvasId: 2 })].map(dbRow));
    vUpdate.mockResolvedValue({});
    vGemini.mockResolvedValue(geminiAnswers([1])); // #2 omitted from the response
    expect(await runAnalysis(7)).toMatchObject({ analyzed: 1, remaining: 1, done: false });
  });
  it("AI unavailable → fails open: nothing written, backlog intact, drain stops", async () => {
    const { runAnalysis } = await vi.importActual<typeof import("@/lib/analysisStore")>("@/lib/analysisStore");
    vFindMany.mockResolvedValue([row({ canvasId: 1 })].map(dbRow));
    vGemini.mockResolvedValue({ res: { ok: false, status: 500 }, timedOut: false });
    const res = await runAnalysis(7);
    expect(res).toMatchObject({ analyzed: 0, ok: false, remaining: 1 });
    expect(vUpdate).not.toHaveBeenCalled();
    expect(shouldContinue(0, res)).toBe(false);
  });
});

// --- 4. grep guards: the client really uses the shared cap ------------------
describe("client drain guards", () => {
  const src = readFileSync("components/useAutoSync.ts", "utf8");
  it("useAutoSync imports the cap from lib/analysisLoop (single source, not a local 6)", () => {
    expect(src).toMatch(/import\s*\{[^}]*MAX_ANALYZE_ROUNDS[^}]*\}\s*from\s*"@\/lib\/analysisLoop"/);
    expect(src).not.toMatch(/const\s+MAX_ANALYZE_ROUNDS\s*=/);
    expect(src).not.toMatch(/from\s*"@\/lib\/analysis"/); // never the server module from a client
  });
  it("the loop is bounded by that constant and pauses between rounds", () => {
    expect(src).toMatch(/for\s*\(let round = 0; round < MAX_ANALYZE_ROUNDS; round\+\+\)/);
    expect(src).toMatch(/ANALYZE_ROUND_PAUSE_MS = 300/);
  });
  it("router.refresh() runs ONCE after the loop, never per round", () => {
    expect(src.match(/router\.refresh\(\)/g)?.length).toBe(1);
    expect(src).toMatch(/if \(analyze\) await drainAnalysis\(\);\s*\n\s*router\.refresh\(\);/);
    const drain = src.slice(src.indexOf("async function drainAnalysis"), src.indexOf("export function useAutoSync"));
    expect(drain).not.toContain("router.refresh");
  });
  it("only the drain posts to /api/analyze (no stray single-shot call left behind)", () => {
    expect(src.match(/"\/api\/analyze"/g)?.length).toBe(1);
  });
  it("the sync spinner is released BEFORE the drain, and released once", () => {
    // The drain is AI work, not Canvas work: it can run ~75s, so the Sync button
    // must not spin for it and a focus sync must not be blocked by it.
    expect(src).toMatch(/release\(\);\s*(\n\s*\/\/[^\n]*)*\n\s*if \(analyze\) await drainAnalysis\(\);/);
    expect(src).toMatch(/} finally \{\s*\n\s*release\(\);\s*\n\s*\}/);
    expect(src).toMatch(/if \(released\) return;/); // idempotent: never stops a LATER run's spinner
    const body = src.slice(src.indexOf("const run = useCallback"));
    expect(body).not.toMatch(/finally \{\s*\n\s*inFlight\.current = false/); // no direct un-flagging left
  });
  it("both drain loops share ONE stop rule and ONE cap", () => {
    const first = readFileSync("components/FirstSyncProgress.tsx", "utf8");
    expect(first).toMatch(/import\s*\{[^}]*MAX_ANALYZE_ROUNDS[^}]*shouldContinue[^}]*\}\s*from\s*"@\/lib\/analysisLoop"/);
    expect(first).not.toMatch(/const\s+MAX_ANALYZE_ROUNDS\s*=/);
    expect(first).toMatch(/if \(!shouldContinue\(i, a\)\) break;/);
    expect(first).not.toMatch(/a\?\.ok\s*\|\|/); // its private stop rule is gone
    // ...but it keeps its first-run shape: no pause, no refresh (it hard-navigates)
    expect(first).not.toMatch(/ANALYZE_ROUND_PAUSE_MS/);
    expect(first).not.toMatch(/router\.refresh/);
    expect(first).toMatch(/window\.location\.href = "\/dashboard\?welcome=1"/);
  });
  it("the route throttles via the shared limiter, never a private map", () => {
    const route = readFileSync("app/api/analyze/route.ts", "utf8");
    expect(route).toMatch(/import \{ rateLimit \} from "@\/lib\/rateLimit"/);
    expect(route).toMatch(/rateLimit\("analyze", String\(user\.id\), ANALYZE_RATE\)/);
    expect(route).toMatch(/limit: 8, windowMs: 60_000/);
    expect(route).not.toMatch(/new Map\(/);
  });
  // The whole point of the split: a "use client" file may import the cap without
  // dragging node crypto / prisma / the Gemini fetch into the browser bundle.
  it("lib/analysisLoop.ts imports NOTHING — no node builtins, no prisma, no geminiFetch", () => {
    const loop = readFileSync("lib/analysisLoop.ts", "utf8");
    const code = loop.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); // comments may NAME them
    expect(code).not.toMatch(/^\s*import\b/m); // no import statement of ANY kind
    expect(code).not.toMatch(/\bfrom\s*["']/); // and no re-export from another module
    expect(code).not.toMatch(/require\(/);
    expect(code).not.toMatch(/\b(crypto|fs|path|prisma|geminiFetch|analysisStore)\b/);
  });
  it("lib/analysis re-exports the loop, so server callers keep one import path", () => {
    expect(readFileSync("lib/analysis.ts", "utf8")).toMatch(
      /export \{[^}]*MAX_ANALYZE_ROUNDS[^}]*\} from "\.\/analysisLoop"/,
    );
    expect(MAX_ANALYZE_ROUNDS).toBe(analysisLoop.MAX_ANALYZE_ROUNDS);
    expect(shouldContinue).toBe(analysisLoop.shouldContinue);
  });
});
