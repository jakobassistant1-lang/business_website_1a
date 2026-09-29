import { requirePageAccess } from "@/lib/access";
import { loadCalendarData } from "@/lib/calendarData";
import { dataToday } from "@/lib/studentZone";
import { focusSlice } from "@/lib/rankActive";
import { PlanSurface } from "@/components/PlanSurface";

export const dynamic = "force-dynamic";

// The student's coursework in one place — List (do-next) / Calendar / Timeline.
export default async function PlanPage() {
  const user = await requirePageAccess(); // #119 gate, re-run per page (see lib/access)
  const data = await loadCalendarData(user.id);
  // THE Focus list (lib/rankActive.focusSlice, uncapped) — computed here on the
  // server because that module must not enter the browser bundle (lib/planFocus).
  return <PlanSurface data={data} todayYmd={dataToday(data)} focusOrder={focusSlice(data.ranked, Infinity).map((r) => r.canvasId)} />;
}
