// Fetch + normalize + sync Google Calendar events. The adapter (normalizeEvent)
// maps Google's shape into the app's internal event format — the only contract
// the rest of the app sees. Nothing here touches Canvas.

import { prisma } from "../prisma";
import { calendarApiGet } from "./client";
import type { GoogleApiEvent, InternalCalendarEvent } from "./types";

/** Adapter: Google API event → internal format. Pure + unit-tested. Returns null
 *  for events we can't represent (no id, or missing start/end). */
export function normalizeEvent(e: GoogleApiEvent): InternalCalendarEvent | null {
  if (!e.id) return null;
  // All-day events carry a floating `date` (no time, no zone). Anchor them to
  // NOON UTC, not midnight: midnight-UTC renders as the *previous day* for any
  // user west of UTC, whereas noon keeps the calendar date correct across all
  // real-world offsets (UTC-12 … UTC+12).
  const allDay = (d: string) => `${d}T12:00:00.000Z`;
  const start = e.start?.dateTime ?? (e.start?.date ? allDay(e.start.date) : null);
  const end = e.end?.dateTime ?? (e.end?.date ? allDay(e.end.date) : null);
  if (!start || !end) return null;
  const startTime = new Date(start);
  const endTime = new Date(end);
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) return null;
  return {
    id: e.id,
    title: e.summary?.trim() || "(no title)",
    description: e.description ?? undefined,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    location: e.location ?? undefined,
    source: "google",
  };
}

const MAX_PAGES = 6; // up to ~1500 events — bounds a runaway calendar

/** Fetch the next `days` of events from the primary calendar, normalized,
 *  following pagination so heavy calendars aren't silently truncated. */
export async function fetchUpcomingEvents(userId: number, days = 30): Promise<InternalCalendarEvent[]> {
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + days * 86_400_000).toISOString();
  const out: InternalCalendarEvent[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "250" });
    if (pageToken) q.set("pageToken", pageToken);
    const json = (await calendarApiGet(userId, `/calendars/primary/events?${q.toString()}`)) as {
      items?: GoogleApiEvent[];
      nextPageToken?: string;
    };
    for (const e of Array.isArray(json.items) ? json.items : []) {
      if (e.status === "cancelled") continue;
      const n = normalizeEvent(e);
      if (n) out.push(n);
    }
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  return out;
}

/** Fetch the next 30 days and replace the user's stored Google events. */
export async function syncCalendar(userId: number): Promise<{ synced: number }> {
  const conn = await prisma.googleCalendarConnection.findUnique({ where: { userId } });
  if (!conn) throw new Error("not_connected");

  const events = await fetchUpcomingEvents(userId, 30);
  // De-dupe by Google event id: recurring-instance overrides / page overlap can
  // repeat an id, which would otherwise violate @@unique and abort the sync.
  const unique = [...new Map(events.map((e) => [e.id, e])).values()];

  await prisma.$transaction([
    prisma.googleCalendarEvent.deleteMany({ where: { userId } }),
    ...(unique.length
      ? [
          prisma.googleCalendarEvent.createMany({
            data: unique.map((ev) => ({
              userId,
              connectionId: conn.id,
              googleEventId: ev.id,
              title: ev.title,
              description: ev.description ?? null,
              startTime: new Date(ev.startTime),
              endTime: new Date(ev.endTime),
              location: ev.location ?? null,
              source: "google",
            })),
            skipDuplicates: true,
          }),
        ]
      : []),
    prisma.googleCalendarConnection.update({ where: { userId }, data: { syncedAt: new Date() } }),
  ]);

  return { synced: unique.length };
}

/** Status for the Connections UI. */
export async function getConnectionStatus(userId: number) {
  // Independent reads — run them together to halve the latency this adds to the page.
  const [conn, eventCount] = await Promise.all([
    prisma.googleCalendarConnection.findUnique({ where: { userId } }),
    prisma.googleCalendarEvent.count({ where: { userId } }),
  ]);
  return { conn, eventCount };
}
