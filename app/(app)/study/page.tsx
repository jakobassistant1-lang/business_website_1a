import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { loadCalendarData, upcomingAssessments } from "@/lib/calendarData";
import { studySessionsFor } from "@/lib/study";
import { StudyView } from "@/components/StudyView";

export const dynamic = "force-dynamic";

// The Study hub: upcoming tests/quizzes only — featured card (next per the
// EXISTING recommended order, same `ranked` list the dashboard uses) + rows.
// All study tools live on /study/[canvasId].
export default async function StudyPage({ searchParams }: { searchParams: Promise<{ item?: string }> }) {
  const { item } = await searchParams;
  // Old deep links used /study?item=N — forward them to the per-test page.
  if (item && /^[0-9]+$/.test(item)) redirect(`/study/${item}`);

  const user = await getCurrentUser(); // (app)/layout guarantees auth
  const data = await loadCalendarData(user!.id);

  // Upcoming tests, do-next ordered — shared with the first-run demo (one source
  // of truth so the Study hub and the demo never drift).
  const upcoming = upcomingAssessments(data);

  const sessions: Record<number, { date: string; hours: number }[]> = {};
  for (const it of upcoming) sessions[it.canvasId] = studySessionsFor(data.plan, it.canvasId);

  return <StudyView connected={data.connected} assessments={upcoming} sessions={sessions} />;
}
