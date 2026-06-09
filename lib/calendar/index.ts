// The app-facing entry point for the neutral calendar layer. Today it has one
// provider (Google); a second one just gets added to PROVIDERS and everything
// downstream (the planner) picks it up automatically.

import { googleCalendarProvider } from "../googleCalendar/provider";
import type { CalendarProvider } from "./types";

const PROVIDERS: CalendarProvider[] = [googleCalendarProvider];

/**
 * Combined busy hours per local day (YYYY-MM-DD) across every configured
 * provider. FAIL-OPEN: a provider that errors (or isn't connected) contributes
 * nothing rather than breaking the plan — the planner must always render.
 */
export async function loadBusyHoursByDate(userId: number): Promise<Map<string, number>> {
  const merged = new Map<string, number>();
  await Promise.all(
    PROVIDERS.filter((p) => p.isConfigured()).map(async (p) => {
      try {
        const m = await p.busyHoursByDate(userId);
        for (const [day, hours] of m) merged.set(day, (merged.get(day) ?? 0) + hours);
      } catch {
        /* fail-open: ignore this provider for this render */
      }
    }),
  );
  return merged;
}
