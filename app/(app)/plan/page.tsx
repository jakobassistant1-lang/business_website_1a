import { requirePageAccess } from "@/lib/access";
import { loadCalendarData } from "@/lib/calendarData";
import { ymd } from "@/lib/calendarDates";
import { PlanSurface } from "@/components/PlanSurface";

export const dynamic = "force-dynamic";

// The student's coursework in one place — List (do-next) / Calendar / Timeline.
export default async function PlanPage() {
  const user = await requirePageAccess(); // #119 gate, re-run per page (see lib/access)
  const data = await loadCalendarData(user.id);
  return <PlanSurface data={data} todayYmd={ymd(new Date())} />;
}
