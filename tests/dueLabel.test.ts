// lib/dueLabel — the one due-date formatter, zone-aware. The bug it replaces:
// `ymd(new Date(iso))` during SSR uses the SERVER's zone (UTC on Vercel), so a
// Tuesday 11:59 PM Eastern deadline rendered as "Wednesday".
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { formatDue, dueParts, isPastDue } from "@/lib/dueLabel";
import { countdownLabel, ymdInZone } from "@/lib/calendarDates";

// Tue Sep 29 2026, 11:59 PM America/New_York == Wed Sep 30 03:59 UTC.
const ISO = "2026-09-30T03:59:00.000Z";
const NY = "America/New_York";
const today = "2026-09-27"; // a Sunday

describe("ymdInZone / dueParts", () => {
  it("reads the calendar day in the given zone", () => {
    expect(ymdInZone(ISO, "UTC")).toBe("2026-09-30");
    expect(ymdInZone(ISO, NY)).toBe("2026-09-29");
    expect(ymdInZone(ISO, "Asia/Tokyo")).toBe("2026-09-30");
  });
  it("gives weekday/month/day/time for that zone", () => {
    expect(dueParts(ISO, NY)).toEqual({ ymd: "2026-09-29", weekday: 2, month: 8, day: 29, time: "11:59 PM" });
    expect(dueParts(ISO, "UTC").time).toBe("3:59 AM");
  });
});

describe("formatDue", () => {
  it("countdown: same words as countdownLabel, zone-aware", () => {
    expect(formatDue(ISO, "countdown", { todayYmd: today, timeZone: NY })).toBe("Tuesday");
    expect(formatDue(ISO, "countdown", { todayYmd: today, timeZone: "UTC" })).toBe("Wednesday");
    expect(countdownLabel(ISO, today, NY)).toBe("Tuesday");
    expect(formatDue(ISO, "countdown", { todayYmd: "2026-09-29", timeZone: NY })).toBe("Today");
    expect(formatDue(ISO, "countdown", { todayYmd: "2026-09-28", timeZone: NY })).toBe("Tomorrow");
    expect(formatDue(ISO, "countdown", { todayYmd: "2026-09-01", timeZone: NY })).toBe("Sep 29");
  });
  it("chip: clock time on the due day, weekday otherwise", () => {
    expect(formatDue(ISO, "chip", { todayYmd: "2026-09-29", timeZone: NY })).toBe("Due 11:59 PM");
    expect(formatDue(ISO, "chip", { todayYmd: today, timeZone: NY })).toBe("Due Tue");
  });
  it("short: Today / Tomorrow / 'Wed 9/30'", () => {
    expect(formatDue(ISO, "short", { todayYmd: today, timeZone: "UTC" })).toBe("Wed 9/30");
    expect(formatDue(ISO, "short", { todayYmd: "2026-09-29", timeZone: NY })).toBe("Today");
    expect(formatDue(ISO, "short", { todayYmd: "2026-09-28", timeZone: NY })).toBe("Tomorrow");
  });
  it("long: the assignment header voice", () => {
    expect(formatDue(ISO, "long", { todayYmd: today, timeZone: NY })).toBe("Due Tuesday, Sep 29");
    expect(formatDue(ISO, "long", { todayYmd: "2026-09-29", timeZone: NY })).toBe("Due today · Tuesday, Sep 29");
    expect(formatDue(ISO, "long", { todayYmd: "2026-09-28", timeZone: NY })).toBe("Due tomorrow · Tuesday, Sep 29");
    expect(formatDue(ISO, "long", { todayYmd: "2026-10-05", timeZone: NY })).toBe("Past due · Tuesday, Sep 29");
  });
  it("long-plain: class page rows", () => {
    expect(formatDue(ISO, "long-plain", { todayYmd: today, timeZone: NY })).toBe("Tuesday, Sep 29");
    expect(formatDue(ISO, "long-plain", { todayYmd: "2026-09-29", timeZone: NY })).toBe("Today · Tuesday, Sep 29");
  });
  it("long-time: study pages", () => {
    expect(formatDue(ISO, "long-time", { todayYmd: today, timeZone: NY })).toBe("Tue, Sep 29 · 11:59 PM");
  });
  it("empty iso → empty string; isPastDue is zone-aware", () => {
    expect(formatDue(null, "long", { todayYmd: today })).toBe("");
    expect(isPastDue(ISO, { todayYmd: "2026-09-30", timeZone: NY })).toBe(true);
    expect(isPastDue(ISO, { todayYmd: "2026-09-30", timeZone: "UTC" })).toBe(false);
  });
});

describe("DueLabel component contract", () => {
  const src = readFileSync("components/DueLabel.tsx", "utf8");
  it("renders UTC + server day before mount, the viewer's zone + local day after", () => {
    expect(src).toContain('"use client"');
    expect(src).toContain("useMounted()");
    expect(src).toContain("useLocalToday(todayYmd)");
    expect(src).toContain('timeZone: "UTC"');
    expect(src).not.toContain("suppressHydrationWarning");
    expect(src).toContain("formatDue(iso, format, { todayYmd, timeZone })"); // student-zone path: no mount swap
  });
});
