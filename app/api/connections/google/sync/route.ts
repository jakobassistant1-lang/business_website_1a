import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { syncCalendar } from "@/lib/googleCalendar/calendar";
import { CalendarError } from "@/lib/calendar/types";

export const dynamic = "force-dynamic";

// POST — re-sync the next 30 days of events. Returns a typed, known reason on
// failure so the UI can recover gracefully (HTTP 200 except rate limits).
export async function POST() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { synced } = await syncCalendar(user.id);
    return NextResponse.json({ ok: true, synced });
  } catch (e) {
    // Typed CalendarError carries a known code; anything else collapses to a
    // generic reason so raw error text never reaches the client.
    const reason = e instanceof CalendarError ? e.code : "sync_failed";
    const status = reason === "rate_limited" ? 429 : 200;
    return NextResponse.json({ ok: false, reason }, { status });
  }
}
