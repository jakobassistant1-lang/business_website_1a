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

  const now = Date.now();
  const rank = new Map(data.ranked.map((r, i) => [r.canvasId, i]));
  const upcoming = data.items
    .filter(
      (it) =>
        (it.type === "quiz" || it.type === "exam") &&
        it.status !== "done" &&
        it.dueAt !== null &&
        new Date(it.dueAt).getTime() >= now,
    )
    .sort((a, b) => {
      const ra = rank.get(a.canvasId) ?? 1e9;
      const rb = rank.get(b.canvasId) ?? 1e9;
      if (ra !== rb) return ra - rb;
      return new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime();
    });

  const sessions: Record<number, { date: string; hours: number }[]> = {};
  for (const it of upcoming) sessions[it.canvasId] = studySessionsFor(data.plan, it.canvasId);

  return <StudyView connected={data.connected} assessments={upcoming} sessions={sessions} />;
}
