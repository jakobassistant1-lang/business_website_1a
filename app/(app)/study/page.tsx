import { loadCalendarData } from "@/lib/calendarData";
import { studySessionsFor } from "@/lib/study";
import { ymd } from "@/lib/calendarDates";
import { StudyView } from "@/components/StudyView";

export const dynamic = "force-dynamic";

// The Study page: pick an upcoming test/quiz (featured = the next one per the
// EXISTING recommended order — the same `ranked` list the dashboard uses) and
// prepare for it: how-to-study plan, AI study guide, practice questions.
export default async function StudyPage({ searchParams }: { searchParams: Promise<{ item?: string }> }) {
  const { item } = await searchParams;
  // (app)/layout guarantees auth; loadCalendarData resolves the user's plan.
  const { getCurrentUser } = await import("@/lib/auth");
  const user = await getCurrentUser();
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

  // Deterministic session blocks per assessment (the plan layer's fixed "when").
  const sessions: Record<number, { date: string; hours: number }[]> = {};
  for (const it of upcoming) sessions[it.canvasId] = studySessionsFor(data.plan, it.canvasId);

  const requested = Number(item);
  const focusId = upcoming.some((it) => it.canvasId === requested) ? requested : upcoming[0]?.canvasId ?? null;

  return (
    <StudyView
      connected={data.connected}
      assessments={upcoming}
      sessions={sessions}
      initialFocusId={focusId}
      todayYmd={ymd(new Date())}
    />
  );
}
