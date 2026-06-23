// Classifies the *shape* of a student's Canvas data so the Dashboard can show a
// sensible, honest first impression when the data is thin, empty, or odd —
// without touching the normal-data path. PURE: reads the existing CalendarData
// (the same payload DashboardView already has); computes nothing new, mutates
// nothing, makes no I/O. The "due today" test mirrors DashboardView exactly so
// the classifier and the dashboard never disagree about what counts as today.

import { ymd } from "@/lib/calendarDates";
import type { CalendarData, CalendarItem } from "@/lib/calendarData";

export type DataShape = "empty" | "all-overdue" | "all-due-later" | "all-undated" | "normal";

/** Same rule DashboardView uses: dated AND its local due-day equals todayYmd. */
function isDueToday(it: CalendarItem, todayYmd: string): boolean {
  return it.dueAt != null && ymd(new Date(it.dueAt)) === todayYmd;
}

/**
 * Which thin/odd shape (if any) the data is in. Checked most-specific first so
 * the branches can't contradict each other:
 *   empty       — no active items and no completed items at all.
 *   all-undated — there are items and EVERY active item has dueAt == null.
 *   all-overdue — no forward-looking recommendations, but overdue items exist.
 *   all-due-later — there are dated items, none due today and none overdue.
 *   normal      — anything else (the untouched dashboard).
 */
export function classifyDataShape(data: CalendarData, todayYmd: string): DataShape {
  if (data.items.length === 0 && data.completed.length === 0) return "empty";

  // "All undated" only makes sense when there's active work to show; an
  // all-completed account (no active items) falls through to normal.
  if (data.items.length > 0 && data.items.every((it) => it.dueAt == null)) return "all-undated";

  if (data.recommendations.length === 0 && data.atRisk.length > 0) return "all-overdue";

  const dated = data.items.filter((it) => it.dueAt != null);
  const noneDueToday = !dated.some((it) => isDueToday(it, todayYmd));
  if (dated.length > 0 && noneDueToday && data.atRisk.length === 0) return "all-due-later";

  return "normal";
}
