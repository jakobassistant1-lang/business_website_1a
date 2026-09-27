"use client";

import { formatDue, type DueFormat } from "@/lib/dueLabel";
import { useLocalToday } from "@/components/useLocalToday";
import { useMounted } from "@/components/useMounted";

/** A due date in words, in the VIEWER's time zone, without a hydration mismatch.
 *  Before mount it renders the UTC reading against the server's `todayYmd`
 *  (identical on the server and the client), then swaps to the viewer's zone and
 *  local day. The ONE way to print a due date in a component — pick a `format`
 *  from lib/dueLabel instead of formatting by hand. */
export function DueLabel({ iso, format, todayYmd, className, empty = "" }: { iso: string | null | undefined; format: DueFormat; todayYmd: string; className?: string; empty?: string }) {
  const mounted = useMounted();
  const today = useLocalToday(todayYmd);
  const text = iso ? formatDue(iso, format, mounted ? { todayYmd: today } : { todayYmd, timeZone: "UTC" }) : empty;
  return <span className={className}>{text}</span>;
}
