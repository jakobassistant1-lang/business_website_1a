import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildPrompt, parseGeminiText, generateBriefing, type BriefingInput } from "@/lib/briefing";
import type { ScoredAssignment } from "@/lib/priority";

function rec(over: Partial<ScoredAssignment> & { canvasId: number }): ScoredAssignment {
  return {
    name: `A${over.canvasId}`,
    courseName: "C",
    htmlUrl: null,
    score: 50,
    reason: "Due today · 10 pts",
    factors: { urgency: 1, impact: 0.1, risk: 0, effort: 0, submittedPenalty: 1 },
    ...over,
  };
}

const INPUT: BriefingInput = {
  firstName: "Maya",
  windowDays: 7,
  inWindowDueCount: 3,
  atRiskCount: 1,
  top: [rec({ canvasId: 1, name: "Essay 2", courseName: "English", reason: "Due in 1 day · 100 pts" })],
};

function geminiResponse(text: string) {
  return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) };
}

describe("buildPrompt", () => {
  it("includes the summary and each ranked priority", () => {
    const p = buildPrompt(INPUT);
    expect(p).toContain("Maya");
    expect(p).toContain("Due in window: 3, at risk: 1");
    expect(p).toContain("1. Essay 2 (English) — Due in 1 day · 100 pts");
    expect(p).toContain("Write the briefing.");
  });
  it("handles an empty priority list", () => {
    expect(buildPrompt({ ...INPUT, top: [] })).toContain("No outstanding priorities.");
  });
});

describe("parseGeminiText", () => {
  it("extracts text from a well-formed response", () => {
    expect(parseGeminiText({ candidates: [{ content: { parts: [{ text: " Focus on Essay 2. " }] } }] })).toBe(
      "Focus on Essay 2.",
    );
  });
  it("returns null for malformed/empty responses", () => {
    expect(parseGeminiText({})).toBeNull();
    expect(parseGeminiText({ candidates: [] })).toBeNull();
    expect(parseGeminiText({ candidates: [{ content: { parts: [] } }] })).toBeNull();
    expect(parseGeminiText(null)).toBeNull();
  });
});

describe("generateBriefing", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("returns no_key WITHOUT calling the network when GEMINI_API_KEY is unset", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const r = await generateBriefing(INPUT);
    expect(r).toEqual({ ok: false, reason: "no_key" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the text on a successful call", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => geminiResponse("Start with Essay 2 — it's due tomorrow.")));
    const r = await generateBriefing(INPUT);
    expect(r).toEqual({ ok: true, text: "Start with Essay 2 — it's due tomorrow.", source: "gemini" });
  });

  it("fails open on an HTTP error (no throw)", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    await expect(generateBriefing(INPUT)).resolves.toEqual({ ok: false, reason: "http_error" });
  });

  it("fails open on a timeout/abort", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      }),
    );
    await expect(generateBriefing(INPUT)).resolves.toEqual({ ok: false, reason: "timeout" });
  });

  it("fails open on an unparseable body", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ nope: true }) })));
    await expect(generateBriefing(INPUT)).resolves.toEqual({ ok: false, reason: "bad_response" });
  });

  it("sends the key in the URL, not in the request body", async () => {
    vi.stubEnv("GEMINI_API_KEY", "secret-123");
    const fetchSpy = vi.fn(async () => geminiResponse("ok"));
    vi.stubGlobal("fetch", fetchSpy);
    await generateBriefing(INPUT);
    const [url, opts] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("key=secret-123");
    expect(String(opts.body)).not.toContain("secret-123");
  });
});
