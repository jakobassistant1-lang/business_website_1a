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
  if (active.length === 0 && completed.length === 0) notFound();

  const courseName = (active[0] ?? completed[0]).courseName;
  const grade = data.courses.find((c) => c.canvasId === id)?.grade;
  return <CoursePage courseName={courseName} grade={grade} active={active} completed={completed} rankedIds={data.ranked.map((r) => r.canvasId)} todayYmd={ymd(new Date())} />;
}
