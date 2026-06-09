import { getCurrentUser } from "@/lib/auth";
import { loadCalendarData } from "@/lib/calendarData";
import { TimelineView } from "@/components/TimelineView";

export const dynamic = "force-dynamic";

// Timeline (Gantt): the recommended order of work, by class, for the day/week.
export default async function TimelinePage() {
  const user = await getCurrentUser(); // layout guarantees auth
  const data = await loadCalendarData(user!.id);
  return <TimelineView data={data} />;
}
