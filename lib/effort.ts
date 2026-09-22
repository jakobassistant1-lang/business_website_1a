// The canonical "how much effort is this item" rule, in its own client-safe file
// (no prisma / node imports) so the browser-bundled week-intensity rule can share
// it instead of forking the formula. `lib/calendarData.ts` re-exports it, so every
// existing `@/lib/calendarData` import site keeps working.

/** The effort to use EVERYWHERE — display and scheduling: a student's manual
 *  override beats the AI estimate. This is the single source; never read
 *  `estimatedEffortHours` raw in a display/schedule path, so a new projection can't
 *  silently bypass the override (the bug fixed in 06ebb2f). Pure + unit-tested. */
export function effectiveEffort(row: { effortOverrideHours?: number | null; estimatedEffortHours?: number | null }): number | null {
  return row.effortOverrideHours ?? row.estimatedEffortHours ?? null;
}
