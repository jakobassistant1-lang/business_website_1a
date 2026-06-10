// Provider-neutral calendar layer. The app talks to *this* contract, not to any
// specific provider — so adding a second calendar (Outlook, Apple) later means
// writing one new provider object, not touching the planner or routes.
//
// This module must NOT import Canvas or any provider's internals.

/** Known calendar sources. Widen the union when a 2nd provider is added. */
export type CalendarSource = "google";

/** A displayable calendar event (for the Calendar's "busy" blocks). */
export interface CalendarEvent {
  title: string;
  startTime: string; // ISO
  endTime: string; // ISO
  allDay: boolean;
  location: string | null;
  source: CalendarSource;
}

/** A calendar provider the app can read from. Kept minimal on purpose;
 *  OAuth/sync/disconnect stay provider-specific until a 2nd provider justifies
 *  generalizing them too. */
export interface CalendarProvider {
  id: CalendarSource;
  /** Server has the env/config needed for this provider to work. */
  isConfigured(): boolean;
  /** Displayable events for this user (for the Calendar's busy blocks). */
  events(userId: number): Promise<CalendarEvent[]>;
}

/** Stable, typed failure codes shared across the calendar client, API routes,
 *  and UI — so a rename can't silently fall through to a generic message. */
export type CalendarErrorCode = "not_connected" | "token_expired" | "rate_limited" | "sync_failed";

export class CalendarError extends Error {
  constructor(public code: CalendarErrorCode) {
    super(code);
    this.name = "CalendarError";
  }
}
