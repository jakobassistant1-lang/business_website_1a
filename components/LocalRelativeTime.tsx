"use client";

import { relativeTime } from "@/lib/calendarDates";
import { useMounted } from "@/components/useMounted";

/** "5 min ago" on the VIEWER's clock — THE way to print a freshness time. The text
 *  is rendered only after mount (a quiet placeholder before), so it is always the
 *  viewer's clock and zone: a server render would have printed older dates
 *  ("Sep 3") in the server's zone and hydration would have kept it. */
export function LocalRelativeTime({ iso }: { iso: string }) {
  const mounted = useMounted();
  return <span>{mounted ? relativeTime(iso) : "…"}</span>;
}
