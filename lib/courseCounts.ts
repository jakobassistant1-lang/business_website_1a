// THE per-course split of coursework (2026-09-28, "everything should agree
// everywhere"). The course card and the course page both read it, so a count can
// never disagree with the list it counts: a card once said "Nothing upcoming." and
// "3 upcoming" at once because passive grades were left out of "Do next" but
// counted. Pure and client-safe.
//
// Every active item lands in exactly ONE bucket, checked in this order:
//   passive   → "Graded by your teacher" (participation etc.: nothing to do, no check-off)
//   locked    → "Not open yet" (the teacher hasn't opened it)
//   overdue   → "Past due"
//   otherwise → "Upcoming"
// and every completed item is "Done". "Do next" is picked from Past due + Upcoming
// only, so "nothing to do" and "N upcoming" can't both be true.

import type { CalendarItem } from "./calendarData";

export interface CourseBuckets {
  pastDue: CalendarItem[];
  upcoming: CalendarItem[];
  notOpenYet: CalendarItem[];
  passive: CalendarItem[];
  done: CalendarItem[];
}

export type CourseCounts = { [K in keyof CourseBuckets]: number };

/** Importance order (the app's `ranked` list), then earliest due, undated last —
 *  the same tie-break the Study hub uses. */
function rankOrder(rankedIds: readonly number[]) {
  const rank = new Map(rankedIds.map((id, i) => [id, i] as const));
  const due = (it: CalendarItem) => (it.dueAt ? new Date(it.dueAt).getTime() : Infinity);
  return (a: CalendarItem, b: CalendarItem) => {
    const ra = rank.get(a.canvasId) ?? 1e9;
    const rb = rank.get(b.canvasId) ?? 1e9;
    if (ra !== rb) return ra - rb;
    return due(a) - due(b);
  };
}

/** Split one course's items into the five buckets. With `rankedIds`, the active
 *  buckets are in importance order; Done is most recent first. */
export function courseBuckets(items: readonly CalendarItem[], completed: readonly CalendarItem[], rankedIds: readonly number[] = []): CourseBuckets {
  const b: CourseBuckets = { pastDue: [], upcoming: [], notOpenYet: [], passive: [], done: [] };
  for (const it of items) {
    if (it.status === "done") b.done.push(it);
    else if (it.passive) b.passive.push(it);
    else if (it.locked) b.notOpenYet.push(it);
    else if (it.status === "overdue") b.pastDue.push(it);
    else b.upcoming.push(it);
  }
  b.done.push(...completed);
  const byRank = rankOrder(rankedIds);
  b.pastDue.sort(byRank);
  b.upcoming.sort(byRank);
  b.notOpenYet.sort(byRank);
  b.passive.sort(byRank);
  const due = (it: CalendarItem) => (it.dueAt ? new Date(it.dueAt).getTime() : -Infinity);
  b.done.sort((x, y) => due(y) - due(x));
  return b;
}

/** The five counts — always the lengths of the lists the course page shows. */
export function courseCounts(items: readonly CalendarItem[], completed: readonly CalendarItem[]): CourseCounts {
  return countsOf(courseBuckets(items, completed));
}

export function countsOf(b: CourseBuckets): CourseCounts {
  return { pastDue: b.pastDue.length, upcoming: b.upcoming.length, notOpenYet: b.notOpenYet.length, passive: b.passive.length, done: b.done.length };
}

/** "Do next" for a course: its top-ranked actionable item, past due included (the
 *  Focus rule — top priority no matter what). Null only when Past due and
 *  Upcoming are both empty. */
export function doNext(items: readonly CalendarItem[], completed: readonly CalendarItem[], rankedIds: readonly number[]): CalendarItem | null {
  const b = courseBuckets(items, completed, rankedIds);
  return [...b.pastDue, ...b.upcoming].sort(rankOrder(rankedIds))[0] ?? null;
}

export type DoneReason = NonNullable<CalendarItem["doneReason"]>;

/** Why a done row is done, in the student's words. "Date passed" is NOT a
 *  completion: the date of an exam/quiz went by with nothing handed in, so it says
 *  so — a missed quiz must never read like a finished one. */
export const DONE_REASON_LABEL: Record<DoneReason, string> = {
  submitted: "Submitted",
  graded: "Graded",
  manual: "Marked done by you",
  date_passed: "Date passed · not submitted",
};

/** A done item's reason. `date_passed` gives way to "graded" as soon as Canvas
 *  reports a score (the normal rule). Items from before the field existed fall back
 *  to what the row itself says (checked off by the student, else submitted). */
export function doneReasonOf(it: Pick<CalendarItem, "doneReason" | "manuallyDone" | "score">): DoneReason {
  if (it.doneReason === "date_passed" && it.score != null) return "graded";
  return it.doneReason ?? (it.manuallyDone ? "manual" : "submitted");
}

/** How a done row reads: the label, and whether it is a real completion ("success":
 *  green check, struck-through title) or only a date going by ("missed": a muted
 *  marker, muted text, no green). One mapping for every done row. */
export function doneRowView(it: Pick<CalendarItem, "doneReason" | "manuallyDone" | "score">): { reason: DoneReason; label: string; tone: "success" | "missed" } {
  const reason = doneReasonOf(it);
  return { reason, label: DONE_REASON_LABEL[reason], tone: reason === "date_passed" ? "missed" : "success" };
}

/** The course header sentence's parts: EVERY non-zero bucket, in section order, so
 *  the numbers add up to the course's items ("2 past due · 3 upcoming · 1 graded by
 *  your teacher · 4 done"). */
export function courseSummaryParts(c: CourseCounts): string[] {
  const parts = [
    c.pastDue > 0 ? `${c.pastDue} past due` : null,
    c.upcoming > 0 ? `${c.upcoming} upcoming` : null,
    c.notOpenYet > 0 ? `${c.notOpenYet} not open yet` : null,
    c.passive > 0 ? `${c.passive} graded by your teacher` : null,
    c.done > 0 ? `${c.done} done` : null,
  ].filter((p): p is string => p != null);
  return parts.length > 0 ? parts : ["No work posted yet"];
}

/** "You're clear": nothing past due, upcoming or waiting to open. */
export function isClear(c: CourseCounts): boolean {
  return c.pastDue + c.upcoming + c.notOpenYet === 0;
}
