// Ticket #46 — the admin standup log. Pure helpers (no Prisma client, no React)
// shared by the server page, the API route and the client component, so the
// validation, the history window and the day grouping have ONE definition.
import type { Prisma } from "@prisma/client";
import { ymd, parseYmd, addDays, daysBetween, WEEKDAYS_FULL, MONTHS_LONG } from "./calendarDates";

/** Max characters per text field (yesterday / today / blockers). */
export const STANDUP_MAX_CHARS = 4000;
/** How many days of history the page and GET return. */
export const STANDUP_WINDOW_DAYS = 60;

/** The wire/prop shape of one entry (dates as ISO strings for the client). */
export type StandupEntryDto = {
  id: number;
  date: string; // "YYYY-MM-DD"
  author: string;
  authorId: number | null;
  yesterday: string;
  today: string;
  blockers: string | null;
  updatedAt: string;
};

export type StandupInput = { date: string; yesterday: string; today: string; blockers: string | null };
export type ParseResult = { ok: true; value: StandupInput } | { ok: false; error: string };

/** How far (in days) a posted date may sit from the server's current day. The
 *  author's local day can be a day ahead of / behind the server's (UTC on
 *  Vercel); anything further is rejected — it would be saved but fall outside
 *  the history window or never be "today" for anyone. */
export const STANDUP_DATE_SLACK_DAYS = 1;

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Validate a POST body: trims every field, requires yesterday + today and a real
 *  date within ±STANDUP_DATE_SLACK_DAYS of `now` (the server's clock), blockers
 *  optional (blank → null), each field at most STANDUP_MAX_CHARS. */
export function parseStandupBody(json: unknown, now: Date): ParseResult {
  if (!json || typeof json !== "object") return { ok: false, error: "Invalid request." };
  const b = json as Record<string, unknown>;
  const date = text(b.date);
  const yesterday = text(b.yesterday);
  const today = text(b.today);
  const blockers = text(b.blockers);
  // Real-day check via the app's ONE ymd/parseYmd pair: "2026-02-30" parses to
  // March 2, which doesn't format back to the input.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || ymd(parseYmd(date)) !== date) {
    return { ok: false, error: "Date must be a real day (YYYY-MM-DD)." };
  }
  if (Math.abs(daysBetween(parseYmd(ymd(now)), parseYmd(date))) > STANDUP_DATE_SLACK_DAYS) {
    return { ok: false, error: "You can only post a standup for today." };
  }
  if (!yesterday) return { ok: false, error: "Tell us what you did yesterday." };
  if (!today) return { ok: false, error: "Tell us what you're doing today." };
  for (const [name, v] of [["Yesterday", yesterday], ["Today", today], ["Blockers", blockers]] as const) {
    if (v.length > STANDUP_MAX_CHARS) return { ok: false, error: `${name} is too long (max ${STANDUP_MAX_CHARS} characters).` };
  }
  return { ok: true, value: { date, yesterday, today, blockers: blockers || null } };
}

/** Newest day first; within a day, entries in author (name) order. */
export function groupByDate<T extends { date: string; author: string }>(entries: readonly T[]): { date: string; entries: T[] }[] {
  const byDate = new Map<string, T[]>();
  for (const e of entries) {
    const list = byDate.get(e.date);
    if (list) list.push(e);
    else byDate.set(e.date, [e]);
  }
  return [...byDate.keys()]
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .map((date) => ({
      date,
      entries: [...byDate.get(date)!].sort((a, b) => a.author.localeCompare(b.author, "en")),
    }));
}

/** "2026-09-26" → "Saturday, September 26". Zone-free (built from the ymd parts). */
export function formatStandupDay(dateYmd: string): string {
  const d = parseYmd(dateYmd);
  return `${WEEKDAYS_FULL[d.getDay()]}, ${MONTHS_LONG[d.getMonth()]} ${d.getDate()}`;
}

export const STANDUP_SELECT = {
  id: true,
  date: true,
  author: true,
  authorId: true,
  yesterday: true,
  today: true,
  blockers: true,
  updatedAt: true,
} satisfies Prisma.StandupEntrySelect;

/** The ONE history query (page first paint + GET): last STANDUP_WINDOW_DAYS days,
 *  newest first. "YYYY-MM-DD" strings compare correctly as text. */
export function standupHistoryQuery(now: Date) {
  return {
    where: { date: { gte: ymd(addDays(now, -STANDUP_WINDOW_DAYS)) } },
    orderBy: [{ date: "desc" as const }, { author: "asc" as const }],
    select: STANDUP_SELECT,
  } satisfies Prisma.StandupEntryFindManyArgs;
}

export function toStandupDto(row: {
  id: number;
  date: string;
  author: string;
  authorId: number | null;
  yesterday: string;
  today: string;
  blockers: string | null;
  updatedAt: Date;
}): StandupEntryDto {
  return { ...row, updatedAt: row.updatedAt.toISOString() };
}

/** Replace-or-add an entry by id (the client's in-place update after a save). */
export function upsertEntryInList(list: readonly StandupEntryDto[], saved: StandupEntryDto): StandupEntryDto[] {
  return list.some((e) => e.id === saved.id) ? list.map((e) => (e.id === saved.id ? saved : e)) : [saved, ...list];
}
