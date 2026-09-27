"use client";

import { useEffect, useState } from "react";
import { ymd } from "@/lib/calendarDates";

/** The student's LOCAL calendar day. Server components pass `ymd(new Date())`
 *  computed in the server's zone (UTC on Vercel) — already tomorrow for a US
 *  evening — so after mount this swaps in the device's own day. The ONE place
 *  that correction lives: the Dashboard and the Plan both use it, so "Today's
 *  study" and "Study this week" can never disagree about which day today is. */
export function useLocalToday(serverToday: string): string {
  const [today, setToday] = useState(serverToday);
  useEffect(() => {
    const t = ymd(new Date());
    if (t !== serverToday) setToday(t);
  }, [serverToday]);
  return today;
}
