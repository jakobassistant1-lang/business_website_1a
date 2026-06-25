// Pure date helpers for the Calendar + Timeline views. Local-time based, to
// match the scheduler (which buckets work by the server's local day).

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const WEEKDAYS_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Short "Mon D" in UTC — for admin-board dates (due dates are UTC-midnight ISO;
 *  burndown x-axis is a fixed UTC window). One formatter so the board and the
 *  burndown can't drift apart on the same date. */
export function fmtDateUTC(d: Date | string | number): string {
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Local-midnight Date for a "YYYY-MM-DD" string. Stable across timezones (the
 *  weekday/date of a calendar day don't depend on zone), so passing a ymd string
 *  from the server avoids client-component hydration mismatches. */
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function sameDay(a: Date, b: Date): boolean {
  return ymd(a) === ymd(b);
}

/** Monday-based start of the week containing `d`. */
export function weekStart(d: Date): Date {
  const x = startOfDay(d);
  const diff = (x.getDay() + 6) % 7; // days since Monday
  return addDays(x, -diff);
}

/** 42 days (6 weeks) starting on the Monday on/before the 1st of d's month. */
export function monthGrid(d: Date): Date[] {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const start = weekStart(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/** The {start, days} window the period-coach API should summarize for a view. */
export function rangeForView(view: "day" | "week" | "month", anchor: Date): { start: Date; days: number } {
  if (view === "day") return { start: startOfDay(anchor), days: 1 };
  if (view === "week") return { start: weekStart(anchor), days: 7 };
  return { start: new Date(anchor.getFullYear(), anchor.getMonth(), 1), days: daysInMonth(anchor) };
}

/** Human "do-next" countdown for a due date relative to today: Today / Tomorrow /
 *  weekday (within the week) / "Mon D". Pass the server-computed `todayYmd` so the
 *  client and server agree and there's no hydration drift. Shared by the dashboard,
 *  plan list, and course cards (one source of truth for relative due labels). */
export function countdownLabel(dueAtIso: string, todayYmd: string): string {
  const d = parseYmd(ymd(new Date(dueAtIso)));
  const days = Math.round((d.getTime() - parseYmd(todayYmd).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days <= 6) return WEEKDAYS_FULL[d.getDay()];
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

/** Human "time since" for an announcement's posted date, day-granularity so it
 *  stays hydration-safe (pass the server-computed `todayYmd`): Today / Yesterday /
 *  "{n}d ago" within a week / "Mon D" beyond. Future dates clamp to Today. */
export function relativeDay(postedAtIso: string, todayYmd: string): string {
  const d = parseYmd(ymd(new Date(postedAtIso)));
  const days = Math.round((parseYmd(todayYmd).getTime() - d.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days <= 6) return `${days}d ago`;
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

export function rangeLabel(view: "day" | "week" | "month", anchor: Date, now: Date): string {
  if (view === "day") {
    if (sameDay(anchor, now)) return "Today";
    return `${WEEKDAYS[anchor.getDay()]}, ${MONTHS_LONG[anchor.getMonth()]} ${anchor.getDate()}`;
  }
  if (view === "month") return `${MONTHS_LONG[anchor.getMonth()]} ${anchor.getFullYear()}`;
  const s = weekStart(anchor);
  const e = addDays(s, 6);
  const left = `${MONTHS_SHORT[s.getMonth()]} ${s.getDate()}`;
  const right = s.getMonth() === e.getMonth() ? `${e.getDate()}` : `${MONTHS_SHORT[e.getMonth()]} ${e.getDate()}`;
  return `${left} – ${right}`;
}
