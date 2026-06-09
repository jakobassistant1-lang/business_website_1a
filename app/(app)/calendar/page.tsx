import { getCurrentUser } from "@/lib/auth";
import { loadCalendarData } from "@/lib/calendarData";
import { ymd } from "@/lib/calendarDates";
import { CalendarView } from "@/components/CalendarView";

export const dynamic = "force-dynamic";

// Home view after login: the student's coursework on a calendar (day/week/month).
export default async function CalendarPage() {
  const user = await getCurrentUser(); // layout guarantees auth
  const data = await loadCalendarData(user!.id);
  return <CalendarView data={data} todayYmd={ymd(new Date())} />;
}
