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
  async events(userId: number) {
    const rows = await prisma.googleCalendarEvent.findMany({
      where: { userId },
      orderBy: { startTime: "asc" },
      select: { title: true, startTime: true, endTime: true, allDay: true, location: true },
    });
    return rows.map((r) => ({
      title: r.title,
      startTime: r.startTime.toISOString(),
      endTime: r.endTime.toISOString(),
      allDay: r.allDay,
      location: r.location,
      source: "google" as const,
    }));
  },
};
