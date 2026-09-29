import { describe, it, expect } from "vitest";
import {
  salvageFraction,
  slipLoss,
  coerceLatePolicy,
  parseLatePolicies,
  buildLatePolicyPrompt,
  DEFAULT_LATE_POLICY,
  type LatePolicy,
  type LatePolicyInput,
} from "@/lib/latePolicy";

describe("salvageFraction — credit still earnable if late", () => {
  it("none → 0 (not accepted late)", () => {
    expect(salvageFraction({ kind: "none", value: 0 }, 3)).toBe(0);
  });
  it("flat → fixed remainder regardless of how late", () => {
    expect(salvageFraction({ kind: "flat", value: 0.5 }, 1)).toBeCloseTo(0.5, 6);
    expect(salvageFraction({ kind: "flat", value: 0.5 }, 9)).toBeCloseTo(0.5, 6);
  });
  it("perday → bleeds per day, clamped at 0", () => {
    expect(salvageFraction({ kind: "perday", value: 0.1 }, 3)).toBeCloseTo(0.7, 6);
    expect(salvageFraction({ kind: "perday", value: 0.1 }, 20)).toBe(0);
  });
});

describe("slipLoss — cost of slipping one day (drives on-time urgency)", () => {
  it("none = total loss → maximum pressure", () => {
    expect(slipLoss({ kind: "none", value: 0 })).toBe(1);
  });
  it("flat / perday = their penalty fraction", () => {
    expect(slipLoss({ kind: "flat", value: 0.5 })).toBe(0.5);
    expect(slipLoss({ kind: "perday", value: 0.1 })).toBe(0.1);
  });
});

describe("coerceLatePolicy — fails open to no-credit", () => {
  it("garbage / missing → default", () => {
    expect(coerceLatePolicy(null)).toEqual(DEFAULT_LATE_POLICY);
    expect(coerceLatePolicy({ kind: "weird" })).toEqual(DEFAULT_LATE_POLICY);
    expect(coerceLatePolicy({})).toEqual(DEFAULT_LATE_POLICY);
  });
  it("none ignores any value", () => {
    expect(coerceLatePolicy({ kind: "none", value: 0.9 })).toEqual({ kind: "none", value: 0 });
  });
  it("clamps the fraction to 0..1", () => {
    expect(coerceLatePolicy({ kind: "perday", value: 5 })).toEqual({ kind: "perday", value: 1 });
  });
  it("a zero penalty is a REAL no-penalty policy (late accepted), not 'none' (late NOT accepted)", () => {
    expect(coerceLatePolicy({ kind: "flat", value: 0 })).toEqual({ kind: "flat", value: 0 });
    expect(coerceLatePolicy({ kind: "perday", value: 0 })).toEqual({ kind: "flat", value: 0 });
    expect(coerceLatePolicy({ kind: "flat", value: "0" })).toEqual({ kind: "flat", value: 0 });
  });
  it("a missing / non-numeric / negative value is garbage → default", () => {
    expect(coerceLatePolicy({ kind: "flat" })).toEqual(DEFAULT_LATE_POLICY);
    expect(coerceLatePolicy({ kind: "perday", value: "lots" })).toEqual(DEFAULT_LATE_POLICY);
    expect(coerceLatePolicy({ kind: "flat", value: -0.2 })).toEqual(DEFAULT_LATE_POLICY);
    expect(coerceLatePolicy({ kind: "flat", value: null })).toEqual(DEFAULT_LATE_POLICY);
  });
  it("no-penalty policy: full salvage however late, zero slip loss", () => {
    const free = coerceLatePolicy({ kind: "flat", value: 0 });
    expect(salvageFraction(free, 0)).toBe(1);
    expect(salvageFraction(free, 30)).toBe(1);
    expect(slipLoss(free)).toBe(0);
  });
});

describe("parseLatePolicies — Gemini output → per-course policies", () => {
  const inputs: LatePolicyInput[] = [
    { courseId: 1, courseName: "Bio", syllabus: "Late work loses 10% per day." },
    { courseId: 2, courseName: "Hist", syllabus: "No late work accepted." },
    { courseId: 3, courseName: "Calc", syllabus: "Late work: flat 50% off." },
  ];

  it("matches BY id and coerces each policy", () => {
    const json = { candidates: [{ content: { parts: [{ text: JSON.stringify([
      { id: 1, kind: "perday", value: 0.1 },
      { id: 2, kind: "none", value: 0 },
      { id: 3, kind: "flat", value: 0.5 },
    ]) }] } }] };
    const out = parseLatePolicies(json, inputs);
    expect(out.find((o) => o.courseId === 1)?.policy).toEqual({ kind: "perday", value: 0.1 });
    expect(out.find((o) => o.courseId === 2)?.policy).toEqual({ kind: "none", value: 0 });
    expect(out.find((o) => o.courseId === 3)?.policy).toEqual({ kind: "flat", value: 0.5 });
  });

  it("drops unknown ids and tolerates a ```json fence", () => {
    const json = { candidates: [{ content: { parts: [{ text: "```json\n[{\"id\":1,\"kind\":\"perday\",\"value\":0.2},{\"id\":99,\"kind\":\"none\",\"value\":0}]\n```" }] } }] };
    const out = parseLatePolicies(json, inputs);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ courseId: 1, policy: { kind: "perday", value: 0.2 } });
  });

  it("malformed JSON → empty (caller defaults every course)", () => {
    const json = { candidates: [{ content: { parts: [{ text: "not json" }] } }] };
    expect(parseLatePolicies(json, inputs)).toEqual([]);
  });
});

describe("buildLatePolicyPrompt — easy for Gemini", () => {
  it("echoes each course id and asks for the compact array shape", () => {
    const p = buildLatePolicyPrompt([{ courseId: 7, courseName: "Bio", syllabus: "<p>10% per day</p>" }]);
    expect(p).toContain("#7 Bio");
    expect(p).not.toContain("<p>"); // HTML stripped
    expect(p).toContain('"id"');
    expect(p).toContain("none|flat|perday");
  });
});

describe("#144: the same read extracts the grading scheme", () => {
  const inputs: LatePolicyInput[] = [
    { courseId: 1, courseName: "Micro", syllabus: "Homework 20% (10 sets). Exams 80%." },
    { courseId: 2, courseName: "Finance", syllabus: "Late work accepted without penalty." },
  ];
  const wrap = (arr: unknown) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(arr) }] } }] });

  it("parses grading next to the policy (percents normalized); omits it when absent", () => {
    const out = parseLatePolicies(
      wrap([
        { id: 1, kind: "perday", value: 0.1, grading: { categories: [{ name: "Homework", weight: 20, count: 10 }, { name: "Exams", weight: 80 }] } },
        { id: 2, kind: "flat", value: 0 },
      ]),
      inputs,
    );
    expect(out[0]).toEqual({
      courseId: 1,
      policy: { kind: "perday", value: 0.1 },
      grading: { categories: [{ name: "Homework", weight: 0.2, count: 10 }, { name: "Exams", weight: 0.8 }] },
    });
    // the no-penalty answer survives parsing (audit fix) and has no grading key
    expect(out[1]).toEqual({ courseId: 2, policy: { kind: "flat", value: 0 } });
  });

  it("garbage grading is dropped without losing the policy", () => {
    const out = parseLatePolicies(wrap([{ id: 1, kind: "none", value: 0, grading: "lots of homework" }]), inputs);
    expect(out).toEqual([{ courseId: 1, policy: { kind: "none", value: 0 } }]);
  });

  it("the prompt asks for grading, forbids invented numbers and non-JSON prose", async () => {
    const { DEFAULT_LATE_INSTRUCTION, GRADING_INSTRUCTION } = await import("@/lib/latePolicy");
    expect(DEFAULT_LATE_INSTRUCTION).toContain(GRADING_INSTRUCTION);
    expect(GRADING_INSTRUCTION).toMatch(/Never estimate, guess, or invent a number/);
    expect(GRADING_INSTRUCTION).toMatch(/Output JSON only/);
    expect(DEFAULT_LATE_INSTRUCTION).toContain('Late work accepted with NO penalty → {"kind":"flat","value":0}');
    expect(buildLatePolicyPrompt(inputs)).toContain('"grading"');
  });

  it("LATE_POLICY_VERSION was bumped so every course re-reads once", async () => {
    const { LATE_POLICY_VERSION } = await import("@/lib/latePolicy");
    expect(LATE_POLICY_VERSION).toBeGreaterThanOrEqual(2);
  });
});

describe("#144 review: a cut-off reply", () => {
  const inputs: LatePolicyInput[] = [
    { courseId: 1, courseName: "Micro", syllabus: "..." },
    { courseId: 2, courseName: "Finance", syllabus: "..." },
    { courseId: 3, courseName: "History", syllabus: "..." },
  ];
  const cut = (text: string, finishReason = "MAX_TOKENS") => ({ candidates: [{ finishReason, content: { parts: [{ text }] } }] });

  it("keeps complete entries, keeps the POLICY of the entry cut inside its grading (marked truncated), drops one cut before its value ends", () => {
    const text =
      '[{"id":1,"kind":"perday","value":0.1,"grading":{"totalPoints":1000}},' +
      '{"id":2,"kind":"flat","value":0.5,"grading":{"categories":[{"name":"Home' +
      "";
    const out = parseLatePolicies(cut(text), inputs);
    expect(out).toEqual([
      { courseId: 1, policy: { kind: "perday", value: 0.1 }, grading: { totalPoints: 1000 } },
      { courseId: 2, policy: { kind: "flat", value: 0.5 }, truncated: true },
    ]);
    // cut mid-number: "0.1" might have been "0.15" → not read
    expect(parseLatePolicies(cut('[{"id":3,"kind":"perday","value":0.1'), inputs)).toEqual([]);
  });

  it("unbalanced JSON is treated as cut even without finishReason", () => {
    const out = parseLatePolicies(cut('[{"id":3,"kind":"none","value":0,"grading":{"totalPo', "STOP"), inputs);
    expect(out).toEqual([{ courseId: 3, policy: { kind: "none", value: 0 }, truncated: true }]);
  });

  it("a complete reply marks nothing truncated", () => {
    const out = parseLatePolicies(cut('[{"id":1,"kind":"none","value":0}]', "STOP"), inputs);
    expect(out).toEqual([{ courseId: 1, policy: { kind: "none", value: 0 } }]);
  });
});
