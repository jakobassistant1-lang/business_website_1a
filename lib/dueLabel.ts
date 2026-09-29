// The ONE place a due-date instant becomes words. Every surface picks a named
// format instead of hand-rolling `${WEEKDAYS[d.getDay()]}, …` (that fork is how the
// dashboard, study, assignment and class pages each drifted — and each computed
// the day in the SERVER's zone during SSR, which is UTC on Vercel).
//
// `timeZone` undefined = the viewer's zone. Pass "UTC" when the render must match
// between server and hydration; components/DueLabel does that, then re-renders in
// the viewer's zone after mount. Pure and node-free — unit-tested with fixed zones.

import { MONTHS_SHORT, WEEKDAYS, WEEKDAYS_FULL, countdownLabel, parseYmd, ymdInZone } from "./calendarDates";

export type DueFormat =
  | "countdown" // "Today" · "Tomorrow" · "Wednesday" (≤6 days) · "Oct 7"      — lists, class cards
  | "chip" //      "Due 11:59 PM" (today) · "Due Wed"                             — the violet Focus/hero chips
  | "short" //     "Today" · "Tomorrow" · "Wed 9/30"                               — tight rows where the full day truncates
  | "long" //      "Due today · Wednesday, Sep 30" · "Past due · …" · "Due …"     — assignment page header
  | "long-plain" //"Today · Wednesday, Sep 30" · "Tomorrow · …" · "Wednesday, Sep 30" — class page rows
  | "long-time" //"Mon, Oct 12 · 11:59 PM"                                       — study hub / test pages
  | "day"; //      "Wednesday, Sep 30"                                            — a day heading / a day control's name

export interface DueOpts {
  /** The viewer's (or, pre-mount, the server's) calendar day, "YYYY-MM-DD". */
  todayYmd: string;
  /** undefined = viewer's zone; "UTC" for a hydration-safe pre-mount render. */
  timeZone?: string;
}

interface Parts { ymd: string; weekday: number; month: number; day: number; time: string }

/** The pieces of an instant in a zone: its calendar day, weekday (0 = Sun),
 *  month (0-11), day of month and a "11:59 PM" clock string. */
export function dueParts(iso: string, timeZone?: string): Parts {
  const dayYmd = ymdInZone(iso, timeZone);
  const d = parseYmd(dayYmd); // weekday/month/day of a calendar day don't depend on zone
  const t = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
  return { ymd: dayYmd, weekday: d.getDay(), month: d.getMonth(), day: d.getDate(), time: t.replace(/ /g, " ") };
}

/** "Wednesday, Sep 30" — the ONE long day phrase (the long formats and "day"
 *  build on it). */
function longDay(weekday: number, month: number, day: number): string {
  return `${WEEKDAYS_FULL[weekday]}, ${MONTHS_SHORT[month]} ${day}`;
}

/** A CALENDAR day ("YYYY-MM-DD", no instant, so no zone) in the "day" format's
 *  words: "Wednesday, Sep 30". For day headings and day controls. */
export function formatDay(dayYmd: string): string {
  const d = parseYmd(dayYmd);
  return longDay(d.getDay(), d.getMonth(), d.getDate());
}

function daysUntil(dueYmd: string, todayYmd: string): number {
  return Math.round((parseYmd(dueYmd).getTime() - parseYmd(todayYmd).getTime()) / 86_400_000);
}

/** Format a due instant. Returns "" for a null/empty iso so callers can fall back
 *  to their own "No due date" copy. */
export function formatDue(iso: string | null | undefined, format: DueFormat, opts: DueOpts): string {
  if (!iso) return "";
  const { todayYmd, timeZone } = opts;
  const p = dueParts(iso, timeZone);
  const days = daysUntil(p.ymd, todayYmd);
  const long = longDay(p.weekday, p.month, p.day);
  switch (format) {
    case "countdown":
      return countdownLabel(iso, todayYmd, timeZone);
    case "chip":
      return days === 0 ? `Due ${p.time}` : `Due ${WEEKDAYS[p.weekday]}`;
    case "short":
      if (days === 0) return "Today";
      if (days === 1) return "Tomorrow";
      return `${WEEKDAYS[p.weekday]} ${p.month + 1}/${p.day}`;
    case "long":
      if (days < 0) return `Past due · ${long}`;
      if (days === 0) return `Due today · ${long}`;
      if (days === 1) return `Due tomorrow · ${long}`;
      return `Due ${long}`;
    case "long-plain":
      if (days === 0) return `Today · ${long}`;
      if (days === 1) return `Tomorrow · ${long}`;
      return long;
    case "long-time":
      return `${WEEKDAYS[p.weekday]}, ${MONTHS_SHORT[p.month]} ${p.day} · ${p.time}`;
    case "day":
      return long;
  }
}

/** True when the due instant's calendar day (in the zone) is before today. */
export function isPastDue(iso: string | null | undefined, opts: DueOpts): boolean {
  if (!iso) return false;
  return daysUntil(ymdInZone(iso, opts.timeZone), opts.todayYmd) < 0;
}
