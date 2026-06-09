import type { BusyEvent } from "./types";

// Convert calendar events into "busy hours per day", which the planner subtracts
// from each day's study capacity. Pure + unit-tested; no app/provider imports.

function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Next local midnight after `d` (i.e. the end of d's calendar day). */
function nextMidnight(d: Date): Date {
  const x = new Date(d);
  x.setHours(24, 0, 0, 0);
  return x;
}

/**
 * Aggregate timed events into busy hours keyed by local calendar day.
 *
 * - All-day events are intentionally IGNORED: a "Holiday" or a birthday isn't
 *   time you can't study, and counting it as 24h would wrongly zero the day.
 * - Timed events that cross midnight are split across the days they span, so
 *   each day only counts the hours that actually fall in it.
 * - Zero/negative/invalid durations are skipped.
 */
export function busyHoursByDate(events: BusyEvent[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of events) {
    if (e.allDay) continue;
    let cursor = new Date(e.startTime);
    const end = new Date(e.endTime);
    if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) continue;
    if (end <= cursor) continue;
    while (cursor < end) {
      const dayEnd = nextMidnight(cursor);
      const segmentEnd = end < dayEnd ? end : dayEnd;
      const hours = (segmentEnd.getTime() - cursor.getTime()) / 3_600_000;
      const key = ymdLocal(cursor);
      out.set(key, (out.get(key) ?? 0) + hours);
      cursor = dayEnd;
    }
  }
  return out;
}
