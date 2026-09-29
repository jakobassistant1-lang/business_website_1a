import { notFound } from "next/navigation";
import { requirePageAccess } from "@/lib/access";
import { loadCalendarData } from "@/lib/calendarData";
import { dataToday, dataZone } from "@/lib/studentZone";
import { CoursePage } from "@/components/CoursePage";

export const dynamic = "force-dynamic";

// /class/[courseId] — the full assignment list for one course, opened from a
// card on the Courses page. `?tab=grades` opens the grade calculator (the tab
// lives in the URL so a refresh keeps the place).
export default async function ClassDetailPage({ params, searchParams }: { params: Promise<{ courseId: string }>; searchParams: Promise<{ tab?: string | string[] }> }) {
  const user = await requirePageAccess(); // #119 gate, re-run per page (see lib/access)
  const { courseId } = await params;
  const { tab } = await searchParams;
  const id = Number(courseId);
  if (!Number.isFinite(id)) notFound();

  const data = await loadCalendarData(user.id);
  const active = data.items.filter((it) => it.courseCanvasId === id);
  const completed = data.completed.filter((it) => it.courseCanvasId === id);
  // Excluded courses have no items (filtered at the data chokepoint) but must
  // stay reachable so "Include again" has a home — fall back to the course meta.
  const meta = data.courses.find((c) => c.canvasId === id);
  if (active.length === 0 && completed.length === 0 && !meta) notFound();

  const courseName = (active[0] ?? completed[0])?.courseName ?? meta!.name;
  // Parsed here, not by a helper exported from CoursePage: that's a client
  // module, and a server component can't call its functions.
  const initialTab = tab === "grades" ? "grades" : "assignments";
  return (
    <CoursePage
      courseName={courseName}
      grade={meta?.grade}
      active={active}
      completed={completed}
      rankedIds={data.ranked.map((r) => r.canvasId)}
      todayYmd={dataToday(data)}
      timeZone={dataZone(data)}
      courseCanvasId={id}
      excludedCourse={meta?.excluded ?? false}
      initialTab={initialTab}
    />
  );
}
