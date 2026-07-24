import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { loadCalendarData } from "@/lib/calendarData";
import { ymd } from "@/lib/calendarDates";
import { CoursePage } from "@/components/CoursePage";

export const dynamic = "force-dynamic";

// /class/[courseId] — the full assignment list for one class, opened from the
// dashboard's "By class" overview cards.
export default async function ClassDetailPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const id = Number(courseId);
  const user = await getCurrentUser(); // layout guarantees auth
  if (!user || !Number.isFinite(id)) notFound();

  const data = await loadCalendarData(user.id);
  const active = data.items.filter((it) => it.courseCanvasId === id);
  const completed = data.completed.filter((it) => it.courseCanvasId === id);
  // Excluded classes have no items (filtered at the data chokepoint) but must
  // stay reachable so "Include again" has a home — fall back to the course meta.
  const meta = data.courses.find((c) => c.canvasId === id);
  if (active.length === 0 && completed.length === 0 && !meta) notFound();

  const courseName = (active[0] ?? completed[0])?.courseName ?? meta!.name;
  return (
    <CoursePage
      courseName={courseName}
      grade={meta?.grade}
      active={active}
      completed={completed}
      rankedIds={data.ranked.map((r) => r.canvasId)}
      todayYmd={ymd(new Date())}
      courseCanvasId={id}
      excludedCourse={meta?.excluded ?? false}
    />
  );
}
