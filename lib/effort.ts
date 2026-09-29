// THE effort rule (#136, single-source): how many hours an item takes, in its own
// client-safe file (no prisma / node imports) so the browser-bundled intensity rule
// shares it instead of forking the formula. `lib/calendarData.ts` re-exports
// `effectiveEffort`, so every existing `@/lib/calendarData` import site keeps working.
//
//  • An AI estimate is padded ONCE, here, by EFFORT_PADDING (planning-fallacy
//    correction; owner: 10%). Nothing downstream pads again — the scheduler
//    (lib/studyPlan) receives hours that are already padded.
//  • A number the student typed (`effortOverrideHours`) is used and shown AS TYPED.
//  • No number at all ⇒ `effortOrDefault` supplies the user's default hours — the
//    ONE "no estimate yet" rule (scheduler, ranking, week intensity and the tag).
//
// What the plan budgets is what the screen shows: CalendarItem.estimatedEffortHours
// already carries the resolved number, so never run a CalendarItem through these
// helpers again (that would pad twice).

/** Planning-fallacy padding on AI estimates only (10%). */
export const EFFORT_PADDING = 1.1;

/** Smallest effort worth a block or a tag: 0.05h = 3 min, the least that prints as
 *  anything but "0m". Below it: no block (lib/studyPlan) AND no tag (lib/effortFormat). */
export const MIN_BLOCK = 0.05;

/** The schema default of `User.defaultEffortHours` — used ONLY where a caller has no user row to read (fixtures, the demo). */
export const DEFAULT_EFFORT_HOURS = 2;

/** The plan's hour precision (0.01h). Blocks, day totals and resolved effort all
 *  round here, so an item's blocks sum exactly to its displayed effort. */
export function roundHours(h: number): number {
  return Math.round(h * 100) / 100;
}

export interface EffortRow {
  effortOverrideHours?: number | null;
  estimatedEffortHours?: number | null;
}

/** The effort to use EVERYWHERE — display and scheduling: the student's override
 *  as typed, else the AI estimate padded once, else null (no number yet). Never
 *  read `estimatedEffortHours` raw on a display/schedule path (the 06ebb2f bug). */
export function effectiveEffort(row: EffortRow): number | null {
  if (row.effortOverrideHours != null) return row.effortOverrideHours;
  if (row.estimatedEffortHours != null) return roundHours(Math.max(0, row.estimatedEffortHours) * EFFORT_PADDING);
  return null;
}

/** `effectiveEffort`, or the user's default hours when there's no number yet —
 *  THE rule for "no estimate yet" (the default is used as-is, not padded). */
export function effortOrDefault(row: EffortRow, defaultHours: number): number {
  return effectiveEffort(row) ?? defaultHours;
}
