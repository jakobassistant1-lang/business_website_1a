import { describe, it, expect, vi, afterEach } from "vitest";
import {
  clampHours,
  bucketToHours,
  hoursToBucket,
  cleanDescription,
  analysisInputHash,
  needsAnalysis,
  selectUnanalyzed,
  buildAnalysisPrompt,
  parseAnalysis,
  analyzeAssignments,
  type AnalysisItemInput,
  type AnalyzableRow,
} from "@/lib/analysis";

function input(over: Partial<AnalysisItemInput> & { canvasId: number }): AnalysisItemInput {
  return { name: `A${over.canvasId}`, courseName: "C", pointsPossible: 50, dueAt: null, description: null, ...over };
}
function gemini(text: string) {
  return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) };
}

describe("bucket/hours mapping", () => {
  it("clamps hours to a sane range", () => {
    expect(clampHours(0)).toBe(0.25);
    expect(clampHours(999)).toBe(20);
    expect(clampHours(-4)).toBe(0.25);
    expect(clampHours(3)).toBe(3);
  });
  it("maps buckets to hours and back", () => {
    expect(bucketToHours("quick")).toBe(1);
    expect(bucketToHours("long")).toBe(6);
    expect(hoursToBucket(1)).toBe("quick");
    expect(hoursToBucket(3)).toBe("medium");
    expect(hoursToBucket(8)).toBe("long");
  });
});

describe("cleanDescription", () => {
  it("strips tags, collapses whitespace, truncates", () => {
    expect(cleanDescription("<p>Hello   <b>world</b></p>")).toBe("Hello world");
    expect(cleanDescription(null)).toBe("");
    expect(cleanDescription("x".repeat(600)).length).toBe(500);
  });
});

describe("analysisInputHash + needsAnalysis", () => {
  const base: AnalyzableRow = { ...input({ canvasId: 1, description: "essay on topic" }), analyzedAt: new Date(), analysisHash: "" };
  const hash = analysisInputHash(base);

  it("is stable for identical content", () => {
    expect(analysisInputHash(base)).toBe(hash);
  });
  it("changes when content changes but NOT when only the due date changes", () => {
    expect(analysisInputHash({ ...base, name: "different" })).not.toBe(hash);
    expect(analysisInputHash({ ...base, dueAt: "2026-09-09T00:00:00Z" })).toBe(hash);
  });
  it("needs analysis when never analyzed or hash drifted", () => {
    expect(needsAnalysis({ ...base, analyzedAt: null })).toBe(true);
    expect(needsAnalysis({ ...base, analysisHash: hash })).toBe(false);
    expect(needsAnalysis({ ...base, analysisHash: "stale" })).toBe(true);
  });
  it("selectUnanalyzed returns only the rows needing work", () => {
    const rows: AnalyzableRow[] = [
      { ...base, canvasId: 1, analysisHash: analysisInputHash({ ...base, canvasId: 1 }) }, // up to date
      { ...input({ canvasId: 2 }), analyzedAt: null, analysisHash: null }, // never
    ];
    expect(selectUnanalyzed(rows).map((r) => r.canvasId)).toEqual([2]);
  });
});

describe("buildAnalysisPrompt", () => {
  it("includes each item and omits the description segment when null", () => {
    const p = buildAnalysisPrompt([input({ canvasId: 7, name: "Essay", pointsPossible: 100, dueAt: "2026-06-03" })]);
    expect(p).toContain("#7 | Essay | C | 100 pts | due 2026-06-03");
    expect(p).toContain('"id"');
    expect(p).not.toContain("undefined");
  });
});

describe("parseAnalysis", () => {
  const inputs = [input({ canvasId: 1 }), input({ canvasId: 2 })];

  it("matches by id even when reordered", () => {
    const json = gemini(JSON.stringify([
      { id: 2, hours: 3, bucket: "medium", summary: "Do the lab." },
      { id: 1, hours: 1, bucket: "quick", summary: "Quick post." },
    ]));
    const r = parseAnalysis({ candidates: [{ content: { parts: [{ text: JSON.stringify([
      { id: 2, hours: 3, bucket: "medium", summary: "Do the lab." },
      { id: 1, hours: 1, bucket: "quick", summary: "Quick post." },
    ]) }] } }] }, inputs);
    expect(r.find((x) => x.canvasId === 1)?.estimatedEffortHours).toBe(1);
    expect(r.find((x) => x.canvasId === 2)?.bucket).toBe("medium");
    void json;
  });

  it("fills hours from bucket and bucket from hours", () => {
    const r = parseAnalysis({ candidates: [{ content: { parts: [{ text: JSON.stringify([
      { id: 1, bucket: "long", summary: "Big project." },
      { id: 2, hours: 1, summary: "Small." },
    ]) }] } }] }, inputs);
    expect(r.find((x) => x.canvasId === 1)?.estimatedEffortHours).toBe(6);
    expect(r.find((x) => x.canvasId === 2)?.bucket).toBe("quick");
  });

  it("clamps out-of-range hours and nulls bad summaries", () => {
    const r = parseAnalysis({ candidates: [{ content: { parts: [{ text: JSON.stringify([
      { id: 1, hours: 999, summary: 123 },
      { id: 2, hours: 2, summary: "x".repeat(300) },
    ]) }] } }] }, inputs);
    expect(r.find((x) => x.canvasId === 1)?.estimatedEffortHours).toBe(20);
    expect(r.find((x) => x.canvasId === 1)?.summary).toBeNull();
    expect(r.find((x) => x.canvasId === 2)?.summary).toBeNull();
  });

  it("ignores unknown ids and omitted items", () => {
    const r = parseAnalysis({ candidates: [{ content: { parts: [{ text: JSON.stringify([
      { id: 99, hours: 2, summary: "not in inputs" },
      { id: 1, hours: 2, summary: "ok" },
    ]) }] } }] }, inputs);
    expect(r.map((x) => x.canvasId)).toEqual([1]);
  });

  it("parses requiresAction (bool or stringy) and the id even when echoed as a whole line", () => {
    const r = parseAnalysis({ candidates: [{ content: { parts: [{ text: JSON.stringify([
      { id: "#1 | Participation | Bio", hours: 0.5, summary: "Participation grade.", requiresAction: false },
      { id: 2, hours: 2, summary: "Read chapter.", requiresAction: "true" },
    ]) }] } }] }, inputs);
    expect(r.find((x) => x.canvasId === 1)?.requiresAction).toBe(false); // id pulled from "#1 | …"
    expect(r.find((x) => x.canvasId === 2)?.requiresAction).toBe(true);
  });

  it("leaves requiresAction null when the model omits it (→ keep)", () => {
    const r = parseAnalysis({ candidates: [{ content: { parts: [{ text: JSON.stringify([
      { id: 1, hours: 1, summary: "No flag given." },
    ]) }] } }] }, inputs);
    expect(r.find((x) => x.canvasId === 1)?.requiresAction).toBeNull();
  });

  it("handles code fences and returns [] for junk (no throw)", () => {
    const fenced = "```json\n" + JSON.stringify([{ id: 1, hours: 2, summary: "ok" }]) + "\n```";
    expect(parseAnalysis({ candidates: [{ content: { parts: [{ text: fenced }] } }] }, inputs)).toHaveLength(1);
    expect(parseAnalysis({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }, inputs)).toEqual([]);
    expect(parseAnalysis({}, inputs)).toEqual([]);
  });
});

describe("analyzeAssignments", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("returns no_key with zero network when unset", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(await analyzeAssignments([input({ canvasId: 1 })])).toEqual({ ok: false, reason: "no_key" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("makes no call for an empty batch", async () => {
    vi.stubEnv("GEMINI_API_KEY", "k");
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(await analyzeAssignments([])).toEqual({ ok: true, items: [], source: "gemini" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("parses a successful batched response", async () => {
    vi.stubEnv("GEMINI_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn(async () => gemini(JSON.stringify([{ id: 1, hours: 4, bucket: "medium", summary: "Write it." }]))));
    const r = await analyzeAssignments([input({ canvasId: 1 })]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.items[0]).toMatchObject({ canvasId: 1, estimatedEffortHours: 4, bucket: "medium", summary: "Write it." });
  });

  it("fails open on http error and timeout", async () => {
    vi.stubEnv("GEMINI_API_KEY", "k");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    expect(await analyzeAssignments([input({ canvasId: 1 })])).toEqual({ ok: false, reason: "http_error" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw Object.assign(new Error("a"), { name: "AbortError" }); }));
    expect(await analyzeAssignments([input({ canvasId: 1 })])).toEqual({ ok: false, reason: "timeout" });
  });
});
