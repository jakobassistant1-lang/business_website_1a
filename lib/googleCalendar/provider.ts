// Google's implementation of the neutral CalendarProvider contract. This is the
// only file the neutral layer (lib/calendar) needs to know about Google.

import { prisma } from "../prisma";
import { isGoogleConfigured } from "./auth";
import { busyHoursByDate as computeBusyHours } from "../calendar/busy";
import type { CalendarProvider } from "../calendar/types";

export const googleCalendarProvider: CalendarProvider = {
  id: "google",
  isConfigured: isGoogleConfigured,
  async busyHoursByDate(userId: number) {
    const rows = await prisma.googleCalendarEvent.findMany({
      where: { userId },
      select: { startTime: true, endTime: true, allDay: true },
    });
    return computeBusyHours(rows);
  },
};
