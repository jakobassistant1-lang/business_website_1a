// The app-facing entry point for the neutral calendar layer. Today it has one
// provider (Google); a second one just gets added to PROVIDERS and everything
// downstream (the planner) picks it up automatically.

import { googleCalendarProvider } from "../googleCalendar/provider";
import type { CalendarEvent, CalendarProvider } from "./types";

const PROVIDERS: CalendarProvider[] = [googleCalendarProvider];

/**
 * Displayable events across every configured provider (for the Calendar's busy
 * blocks). FAIL-OPEN: a provider that errors contributes nothing.
 */
export async function loadCalendarEvents(userId: number): Promise<CalendarEvent[]> {
  const out: CalendarEvent[] = [];
  await Promise.all(
    PROVIDERS.filter((p) => p.isConfigured()).map(async (p) => {
      try {
        out.push(...(await p.events(userId)));
      } catch {
        /* fail-open */
      }
    }),
  );
  return out;
}
