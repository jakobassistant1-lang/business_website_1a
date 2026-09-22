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

/** Billing dates the student reads ("Free trial ends Monday, October 6") — one
 *  formatter for /account, the in-app cancel note and the card page's charge
 *  date. Pinned to America/New_York for now (Stripe's timestamps are UTC
 *  instants; rendering them in the server's zone would drift on Vercel). A
 *  per-user timezone is a follow-up. */
export const BILLING_TIME_ZONE = "America/New_York";
export function formatDateHuman(d: Date | string | number, opts: { weekday?: boolean } = {}): string {
  return new Date(d).toLocaleDateString("en-US", {
    ...(opts.weekday ? { weekday: "long" } : {}),
    month: "long",
    day: "numeric",
    timeZone: BILLING_TIME_ZONE,
  });
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

/** Whole days from `from` to `to`, midnight-to-midnight local, rounded — THE
 *  day-difference rule ("due in N days", plan day indexing) app-wide. One
 *  implementation so no surface can ever count days differently (single-source
 *  rule; was privately copied in 6 files before 2026-07-21). */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000);
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

/** Human "time since" at clock granularity — "just now" / "12 min ago" /
 *  "3 hours ago" / "yesterday" / "4 days ago", then a short date ("Mar 5", with
 *  the year when it isn't the current one). THE relative-timestamp rule for
 *  freshness lines (the Connections "Last synced …" line); `relativeDay` stays
 *  the day-granularity one for posted dates — don't add a third. Pure: pass
 *  `now` in tests. The text changes by the minute, so a server render and a
 *  hydration a second later can disagree — render it with
 *  `suppressHydrationWarning`. Future timestamps clamp to "just now"; an
 *  unparseable value reads "unknown". */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "unknown";
  const ms = now.getTime() - then.getTime();
  if (ms < 60_000) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(ms / 86_400_000);
  if (days === 1) return "yesterday";
  if (days <= 6) return `${days} days ago`;
  const date = `${MONTHS_SHORT[then.getMonth()]} ${then.getDate()}`;
  return then.getFullYear() === now.getFullYear() ? date : `${date}, ${then.getFullYear()}`;
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
