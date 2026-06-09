import { describe, it, expect } from "vitest";
import { weekStart, monthGrid, rangeForView, daysInMonth, ymd, addDays } from "@/lib/calendarDates";

describe("calendarDates", () => {
  it("weekStart returns the Monday on/before the date", () => {
    const d = new Date(2026, 5, 10); // Jun 10, 2026
    const ws = weekStart(d);
    expect(ws.getDay()).toBe(1); // Monday
    const diffDays = (d.getTime() - ws.getTime()) / 86_400_000;
    expect(diffDays).toBeGreaterThanOrEqual(0);
    expect(diffDays).toBeLessThan(7);
  });

  it("monthGrid is 42 days starting on a Monday", () => {
    const g = monthGrid(new Date(2026, 5, 15));
    expect(g).toHaveLength(42);
    expect(g[0].getDay()).toBe(1);
    expect(ymd(addDays(g[0], 41))).toBe(ymd(g[41]));
  });

  it("rangeForView: day=1, week=7, month=daysInMonth", () => {
    const anchor = new Date(2026, 5, 10);
    expect(rangeForView("day", anchor).days).toBe(1);
    expect(rangeForView("week", anchor).days).toBe(7);
    expect(rangeForView("month", anchor).days).toBe(30); // June
  });

  it("daysInMonth handles month lengths", () => {
    expect(daysInMonth(new Date(2026, 5, 1))).toBe(30); // June
    expect(daysInMonth(new Date(2026, 1, 1))).toBe(28); // Feb 2026
  });
});
