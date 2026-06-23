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
  it("clamps the fraction to 0..1 and rejects a zero penalty", () => {
    expect(coerceLatePolicy({ kind: "perday", value: 5 })).toEqual({ kind: "perday", value: 1 });
    expect(coerceLatePolicy({ kind: "flat", value: 0 })).toEqual(DEFAULT_LATE_POLICY);
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
