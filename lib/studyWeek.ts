// The "Study this week" strip on the Plan page (#39 follow-up): one chip per
// scheduled study session in the next 7 days (today + the 6 after it), read
// straight off the week plan (`data.plan.days[].blocks`). Pure and node-free so
// it's unit-tested without a DOM.
//
// A block counts when it's a real study session (study, not a due-day marker,
// hours > 0) for an assessment that isn't already past. `isStudySessionBlock` is
// the ONE home of that rule (#143): every screen that says "Study …" — the Plan
// strip, components/calendar/parts.tsx's `isUpcomingStudy`, the dashboard's
// "Today's study" — must ask it, never read `b.study`. The zone is REQUIRED: the
// assessment's due day is always read in the student's zone (CalendarData.timeZone),
// so there is exactly one version of the rule (no runtime-zone fallback).

import { WEEKDAYS, parseYmd, ymd, ymdInZone } from "./calendarDates";
import type { DayBlock, PlanDay } from "./scheduler";

export interface StudyChip {
  /** "Today" for today, else the short weekday, e.g. "Mon". */
  dayLabel: string;
  /** The assessment being studied for, e.g. "Quiz 3". */
  title: string;
  /** Session length in hours — format it with lib/effortFormat.fmtHours (the ONE effort formatter). */
  hours: number;
  /** The assessment's Canvas id — the chip links to `/study/<canvasId>`. */
  canvasId: number;
  /** The session's day, "YYYY-MM-DD". */
  date: string;
}

/** Days covered by the strip, counting today. */
export const STUDY_WEEK_DAYS = 7;

/** A real, still-relevant study session (see the header note). The single
 *  source for "is this a study block" — keep it node-free. `todayYmd` = today in
 *  the student's zone; `zone` = that zone (CalendarData.timeZone), in which the
 *  assessment's due day is read. */
export function isStudySessionBlock(
  b: Pick<DayBlock, "study" | "hours" | "dueAt" | "marker">,
  todayYmd: string,
  zone: string,
): boolean {
  if (!b.study || b.marker || !(b.hours > 0)) return false;
  return ymdInZone(b.dueAt, zone) >= todayYmd;
}

/** The chips, sorted by date (plan order within a day). `now` is only read for
 *  its calendar day — callers pass `parseYmd(data.todayYmd)` (today in the
 *  student's zone) — and `zone` (data.timeZone) is the zone due days are read in. */
export function studyChipsFromPlan(days: ReadonlyArray<Pick<PlanDay, "date" | "blocks">>, now: Date, zone: string): StudyChip[] {
  const todayYmd = ymd(now);
  const end = parseYmd(todayYmd);
  end.setDate(end.getDate() + STUDY_WEEK_DAYS);
  const endYmd = ymd(end); // exclusive

  const chips: StudyChip[] = [];
  for (const day of days) {
    if (day.date < todayYmd || day.date >= endYmd) continue;
    const dayLabel = day.date === todayYmd ? "Today" : WEEKDAYS[parseYmd(day.date).getDay()];
    for (const b of day.blocks) {
      if (!isStudySessionBlock(b, todayYmd, zone)) continue;
      chips.push({ dayLabel, title: b.name.trim() || "Study session", hours: b.hours, canvasId: b.canvasId, date: day.date });
    }
  }
  // Stable sort: plan order is kept within a day.
  return chips.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
