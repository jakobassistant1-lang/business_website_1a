import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { loadCalendarData } from "@/lib/calendarData";
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

  const rank = new Map(data.ranked.map((r, i) => [r.canvasId, i]));
  // "Upcoming" defined the SAME way the dashboard does (status === "normal"): keeps
  // tests with no due date and tests due today, excludes completed + past-due. The
  // old `dueAt >= now` check silently dropped every undated test (Exams, Practice
  // Assessments) and any test due earlier today. Ordered do-next, never by the clock.
  const upcoming = data.items
    .filter((it) => (it.type === "quiz" || it.type === "exam") && it.status === "normal")
    .sort((a, b) => {
      const ra = rank.get(a.canvasId) ?? 1e9;
      const rb = rank.get(b.canvasId) ?? 1e9;
      if (ra !== rb) return ra - rb;
      // Tiebreak only matters for unranked items: earliest due first, undated last.
      const ta = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
      const tb = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
      return ta - tb;
    });

  const sessions: Record<number, { date: string; hours: number }[]> = {};
  for (const it of upcoming) sessions[it.canvasId] = studySessionsFor(data.plan, it.canvasId);

  return <StudyView connected={data.connected} assessments={upcoming} sessions={sessions} />;
}
