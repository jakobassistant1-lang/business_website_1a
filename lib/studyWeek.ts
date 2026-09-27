// The "Study this week" strip on the Plan page (#39 follow-up): one chip per
// scheduled study session in the next 7 days (today + the 6 after it), read
// straight off the week plan (`data.plan.days[].blocks`). Pure and node-free so
// it's unit-tested without a DOM.
//
// A block counts when it's a real study session (study + hours > 0) for an
// assessment that isn't already past. `isStudySessionBlock` is the ONE home of
// that rule: components/calendar/parts.tsx's `isUpcomingStudy` (the dashboard's
// "Today's study") calls it rather than keeping its own copy.

import { WEEKDAYS, parseYmd, ymd } from "./calendarDates";
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
 *  source for "is this a study block" — keep it node-free. */
export function isStudySessionBlock(b: Pick<DayBlock, "study" | "hours" | "dueAt">, todayYmd: string): boolean {
  return !!b.study && b.hours > 0 && ymd(new Date(b.dueAt)) >= todayYmd;
}

/** The chips, sorted by date (plan order within a day). `now` is only read for
 *  its local calendar day — callers holding a server `todayYmd` pass
 *  `parseYmd(todayYmd)` so server and client agree. */
export function studyChipsFromPlan(days: ReadonlyArray<Pick<PlanDay, "date" | "blocks">>, now: Date): StudyChip[] {
  const todayYmd = ymd(now);
  const end = parseYmd(todayYmd);
  end.setDate(end.getDate() + STUDY_WEEK_DAYS);
  const endYmd = ymd(end); // exclusive

  const chips: StudyChip[] = [];
  for (const day of days) {
    if (day.date < todayYmd || day.date >= endYmd) continue;
    const dayLabel = day.date === todayYmd ? "Today" : WEEKDAYS[parseYmd(day.date).getDay()];
    for (const b of day.blocks) {
      if (!isStudySessionBlock(b, todayYmd)) continue;
      chips.push({ dayLabel, title: b.name.trim() || "Study session", hours: b.hours, canvasId: b.canvasId, date: day.date });
    }
  }
  // Stable sort: plan order is kept within a day.
  return chips.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
