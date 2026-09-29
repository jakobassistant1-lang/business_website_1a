import { describe, it, expect } from "vitest";
import { effectiveEffort } from "@/lib/calendarData";
import { EFFORT_PADDING, effortOrDefault } from "@/lib/effort";

// The single source of "effort to use" — feeds display AND the scheduler (#14, #136).
// A regression here (or a call site bypassing it) already shipped once (06ebb2f).
describe("effectiveEffort — the student's number as typed, else the AI estimate padded once", () => {
  it("pads AI estimates by 10%, once", () => {
    expect(EFFORT_PADDING).toBe(1.1);
    expect(effectiveEffort({ effortOverrideHours: null, estimatedEffortHours: 4.5 })).toBe(4.95);
    expect(effectiveEffort({ estimatedEffortHours: 3 })).toBe(3.3);
    expect(effectiveEffort({ estimatedEffortHours: 0 })).toBe(0);
  });
  it("uses the override exactly as typed (never padded), including small values", () => {
    expect(effectiveEffort({ effortOverrideHours: 6, estimatedEffortHours: 4.5 })).toBe(6);
    expect(effectiveEffort({ effortOverrideHours: 0.25, estimatedEffortHours: 4.5 })).toBe(0.25);
    expect(effectiveEffort({ effortOverrideHours: 2 })).toBe(2);
  });
  it("is null when neither is set", () => {
    expect(effectiveEffort({ effortOverrideHours: null, estimatedEffortHours: null })).toBeNull();
    expect(effectiveEffort({})).toBeNull();
  });
});

describe("effortOrDefault — THE 'no estimate yet' rule", () => {
  it("falls back to the default hours (unpadded) only when there is no number", () => {
    expect(effortOrDefault({}, 2)).toBe(2);
    expect(effortOrDefault({ estimatedEffortHours: null, effortOverrideHours: null }, 2)).toBe(2);
    expect(effortOrDefault({ estimatedEffortHours: 0 }, 2)).toBe(0); // a real 0 is a number, not "missing"
    expect(effortOrDefault({ estimatedEffortHours: 4.5 }, 2)).toBe(4.95);
    expect(effortOrDefault({ effortOverrideHours: 1.5, estimatedEffortHours: 4.5 }, 2)).toBe(1.5);
  });
});
