import { redirect } from "next/navigation";
import { requirePageAccess } from "@/lib/access";
import { loadCalendarData, upcomingAssessments } from "@/lib/calendarData";
import { studySessionsFor } from "@/lib/study";
import { dataToday, dataZone } from "@/lib/studentZone";
import { StudyView } from "@/components/StudyView";

export const dynamic = "force-dynamic";

// The Study hub: upcoming tests/quizzes only — featured card (next per the
// EXISTING recommended order, same `ranked` list the dashboard uses) + rows.
// All study tools live on /study/[canvasId]. `?missing=1` = that page bounced a
// test that isn't in the plan anymore; the hub says so in one line (#140).
export default async function StudyPage({ searchParams }: { searchParams: Promise<{ item?: string; missing?: string }> }) {
  const user = await requirePageAccess(); // #119 gate, re-run per page (see lib/access)
  const { item, missing } = await searchParams;
  // Old deep links used /study?item=N — forward them to the per-test page.
  if (item && /^[0-9]+$/.test(item)) redirect(`/study/${item}`);

  const data = await loadCalendarData(user.id);

  // Upcoming tests, do-next ordered — shared with the first-run demo (one source
  // of truth so the Study hub and the demo never drift).
  const upcoming = upcomingAssessments(data);

  // Today + zone are the student's (lib/studentZone), never the server's.
  const todayYmd = dataToday(data);
  const timeZone = dataZone(data);
  // Study sessions through the ONE rule (lib/studyWeek.isStudySessionBlock).
  const sessions: Record<number, { date: string; hours: number }[]> = {};
  for (const it of upcoming) sessions[it.canvasId] = studySessionsFor(data.plan, it.canvasId, { todayYmd, zone: timeZone });

  return <StudyView connected={data.connected} assessments={upcoming} sessions={sessions} todayYmd={todayYmd} timeZone={timeZone} missing={missing === "1"} />;
}
