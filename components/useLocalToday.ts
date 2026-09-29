"use client";

import { useEffect, useState } from "react";
import { ymd } from "@/lib/calendarDates";

/** The DEVICE's calendar day, swapped in after mount over a server-computed day.
 *  Legacy: the Dashboard, Plan, Calendar and Timeline no longer use it — they read
 *  the student's Canvas zone (lib/studentZone: `data.todayYmd` / `dataZone(data)`),
 *  which is identical on the server and in every browser, so nothing swaps. Still
 *  used by DueLabel's zone-less path, AssignmentPage and StandupLog. */
export function useLocalToday(serverToday: string): string {
  const [today, setToday] = useState(serverToday);
  useEffect(() => {
    const t = ymd(new Date());
    if (t !== serverToday) setToday(t);
  }, [serverToday]);
  return today;
}
