// THE "Last checked Canvas" timestamp (owner, 2026-09-28): when Navo last checked
// Canvas, from the most recent run of ANY kind. The sync report is written by quick
// and full runs alike, so its time wins; before the first report, the last full
// sync. One function, so the Connections page and CalendarData can't disagree.

import { parseSyncReport } from "./syncReport";

export function lastCheckedAtOf(cred: { lastSyncReport?: unknown; syncedAt?: Date | null } | null | undefined): string | null {
  if (!cred) return null;
  return parseSyncReport(cred.lastSyncReport)?.at ?? (cred.syncedAt ? cred.syncedAt.toISOString() : null);
}
