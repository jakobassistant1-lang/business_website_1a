import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { syncCalendar } from "@/lib/googleCalendar/calendar";
import { CalendarApiError } from "@/lib/googleCalendar/client";

export const dynamic = "force-dynamic";

// POST — re-sync the next 30 days of events. Returns a friendly reason on
// failure so the UI can recover gracefully (always HTTP 200 except rate limits).
export async function POST() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { synced } = await syncCalendar(user.id);
    return NextResponse.json({ ok: true, synced });
  } catch (e) {
    if (e instanceof CalendarApiError && e.status === 429) {
      return NextResponse.json({ ok: false, reason: "rate_limited" }, { status: 429 });
    }
    // Only surface a small, known set of reasons — never raw error text, which
    // could leak internals. The UI maps anything else to a generic message.
    const msg = e instanceof Error ? e.message : "";
    const reason = msg === "not_connected" || msg === "token_expired" ? msg : "sync_failed";
    return NextResponse.json({ ok: false, reason });
  }
}
