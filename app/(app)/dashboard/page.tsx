import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin";
import { isBillingConfigured, hasActiveAccess } from "@/lib/billing";
import { loadCalendarData } from "@/lib/calendarData";
import { ymd } from "@/lib/calendarDates";
import { DashboardView } from "@/components/DashboardView";

export const dynamic = "force-dynamic";

// Home after login: a calm, glanceable dashboard distilled from the same data
// the Calendar/Timeline use — it links into them for the detail.
export default async function DashboardPage() {
  const user = await getCurrentUser(); // layout guarantees auth
  const data = await loadCalendarData(user!.id);

  // Value-first paywall — INERT until billing is configured. A student gets the full
  // free taste (connect → see their plan/the aha → take a first action) and is only
  // asked for the card AFTER that first win (activatedAt is set). With billing OFF,
  // hasActiveAccess() is always true, so this branch never fires and the dashboard is
  // unchanged. NOTE: activatedAt is set by the first-win flow (#107); until that's
  // wired this stays dormant even with billing on. Tune the boundary here once the
  // free-taste line is locked (#101).
  if (
    isBillingConfigured() &&
    !isAdminUser(user!) &&
    data.connected &&
    user!.activatedAt != null &&
    !hasActiveAccess(user!)
  ) {
    redirect("/billing");
  }

  const firstName = user!.fullName.trim().split(/\s+/)[0] ?? "";
  return <DashboardView data={data} todayYmd={ymd(new Date())} firstName={firstName} />;
}
