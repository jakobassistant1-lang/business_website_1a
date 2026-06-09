// Type-safe boundary for the Google Calendar integration. This module is fully
// isolated from Canvas — nothing here references Canvas types or state.

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null; // when accessToken expires
  scope: string | null;
}

/** Raw Google Calendar API v3 event (the subset we read). */
export interface GoogleApiEvent {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string; // "confirmed" | "tentative" | "cancelled"
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
}

/** Internal, app-facing event shape (the adapter target). */
export interface InternalCalendarEvent {
  id: string; // Google event id
  title: string;
  description?: string;
  startTime: string; // ISO
  endTime: string; // ISO
  allDay: boolean; // date-only event (no time); the planner ignores these for busy-time
  location?: string;
  source: "google";
}
