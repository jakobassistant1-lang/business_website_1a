import { getCurrentUser } from "@/lib/auth";
import { loadCalendarData } from "@/lib/calendarData";
import { ymd } from "@/lib/calendarDates";
import { DashboardView } from "@/components/DashboardView";

export const dynamic = "force-dynamic";

// Home after login: a calm, glanceable dashboard distilled from the same data
// the Calendar/Timeline use — it links into them for the detail.
export default async function DashboardPage() {
  const user = await getCurrentUser(); // layout guarantees auth
  const data = await loadCalendarData(user!.id);
  const firstName = user!.fullName.trim().split(/\s+/)[0] ?? "";
  return <DashboardView data={data} todayYmd={ymd(new Date())} firstName={firstName} />;
}
