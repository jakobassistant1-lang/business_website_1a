// THE student's time zone (2026-09-28, Calvin): the zone set in the student's
// Canvas profile — what Canvas itself shows dates in — stored on User.timeZone at
// connect/sync time. EVERY day/date rule reads it: ranking (days until due),
// scheduling (which day a block lands on), past-due status, date labels, and what
// the AI is told. Never the server's zone (UTC on Vercel), never the browser's.
// Pure and client-safe.

import { parseYmd, ymdInZone } from "./calendarDates";

/** Used only until a student's Canvas zone is known (Navo's launch schools are US East). */
export const DEFAULT_STUDENT_ZONE = "America/New_York";

export function isValidZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The zone to use for a student: their Canvas profile zone, else the default. */
export function studentZone(user: { timeZone?: string | null } | null | undefined): string {
  return isValidZone(user?.timeZone) ? user!.timeZone! : DEFAULT_STUDENT_ZONE;
}

/** Today's calendar day ("YYYY-MM-DD") in the zone. */
export function todayInZone(zone: string, now: Date = new Date()): string {
  return ymdInZone(now, zone);
}

/** Whole calendar days from `now`'s day to `target`'s day, both read in the zone
 *  (0 = same day, 1 = tomorrow, -1 = yesterday). THE "days until due" rule. */
export function dayDiffInZone(target: Date | string, zone: string, now: Date = new Date()): number {
  const a = parseYmd(ymdInZone(now, zone)).getTime();
  const b = parseYmd(ymdInZone(target, zone)).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Read the zone / today a loader attached to its data (CalendarData), with safe fallbacks. */
export function dataZone(data: { timeZone?: string | null } | null | undefined): string {
  return isValidZone(data?.timeZone) ? data!.timeZone! : DEFAULT_STUDENT_ZONE;
}
export function dataToday(data: { timeZone?: string | null; todayYmd?: string | null } | null | undefined): string {
  return data?.todayYmd || todayInZone(dataZone(data));
}
