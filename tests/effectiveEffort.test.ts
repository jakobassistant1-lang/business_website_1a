import { describe, it, expect } from "vitest";
import { effectiveEffort } from "@/lib/calendarData";

// The single source of "effort to use" — feeds display AND the scheduler (#14).
// A regression here (or a call site bypassing it) already shipped once (06ebb2f).
describe("effectiveEffort — manual override beats the AI estimate", () => {
  it("uses the override when it's set (including small values)", () => {
    expect(effectiveEffort({ effortOverrideHours: 6, estimatedEffortHours: 4.5 })).toBe(6);
    expect(effectiveEffort({ effortOverrideHours: 0.25, estimatedEffortHours: 4.5 })).toBe(0.25);
  });
  it("falls back to the AI estimate when there's no override", () => {
    expect(effectiveEffort({ effortOverrideHours: null, estimatedEffortHours: 4.5 })).toBe(4.5);
    expect(effectiveEffort({ estimatedEffortHours: 3 })).toBe(3);
  });
  it("is null when neither is set", () => {
    expect(effectiveEffort({ effortOverrideHours: null, estimatedEffortHours: null })).toBeNull();
    expect(effectiveEffort({})).toBeNull();
  });
});
