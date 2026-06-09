import { describe, it, expect } from "vitest";
import { busyHoursByDate } from "@/lib/calendar/busy";

// Times are written WITHOUT a timezone designator, so JS parses them as local —
// and busyHoursByDate buckets by local day, so these are deterministic on any
// machine (both creation and bucketing use the same local zone).

describe("busyHoursByDate", () => {
  it("sums timed-event hours into the correct day", () => {
    const m = busyHoursByDate([
      { startTime: "2026-06-01T09:00:00", endTime: "2026-06-01T11:00:00", allDay: false }, // 2h
      { startTime: "2026-06-01T13:00:00", endTime: "2026-06-01T14:30:00", allDay: false }, // 1.5h
    ]);
    expect(m.get("2026-06-01")).toBeCloseTo(3.5, 5);
  });

  it("ignores all-day events (a holiday isn't busy study time)", () => {
    const m = busyHoursByDate([
      { startTime: "2026-06-01T12:00:00.000Z", endTime: "2026-06-02T12:00:00.000Z", allDay: true },
    ]);
    expect(m.size).toBe(0);
  });

  it("splits an event that crosses midnight across both days", () => {
    const m = busyHoursByDate([
      { startTime: "2026-06-01T23:00:00", endTime: "2026-06-02T01:00:00", allDay: false },
    ]);
    expect(m.get("2026-06-01")).toBeCloseTo(1, 5); // 23:00–24:00
    expect(m.get("2026-06-02")).toBeCloseTo(1, 5); // 00:00–01:00
  });

  it("skips zero, negative, and invalid durations", () => {
    const m = busyHoursByDate([
      { startTime: "2026-06-01T10:00:00", endTime: "2026-06-01T10:00:00", allDay: false }, // zero
      { startTime: "2026-06-01T12:00:00", endTime: "2026-06-01T11:00:00", allDay: false }, // negative
      { startTime: "nonsense", endTime: "also-bad", allDay: false }, // invalid
    ]);
    expect(m.size).toBe(0);
  });
});
