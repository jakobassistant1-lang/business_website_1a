"use client";

import { relativeTime } from "@/lib/calendarDates";

/** "5 min ago" on the VIEWER's clock. Same pattern as ConnectionsForm's freshness
 *  line: a client component, and since the text moves by the minute between the
 *  server render and hydration, that mismatch is allowed. */
export function LocalRelativeTime({ iso }: { iso: string }) {
  return <span suppressHydrationWarning>{relativeTime(iso)}</span>;
}
