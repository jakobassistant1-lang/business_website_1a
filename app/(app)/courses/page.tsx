import Link from "next/link";
import { requirePageAccess } from "@/lib/access";
import { loadCalendarData } from "@/lib/calendarData";
import { CourseGrid } from "@/components/CourseGrid";

export const dynamic = "force-dynamic";

// /courses — the Courses page: the by-course overview, promoted from a dashboard
// toggle to its own surface. Cards link into each course's full list at
// /class/[id]. User-facing copy says "Courses" everywhere (owner, 2026-09-28 —
// reversing #141's "Classes"); the detail route keeps its old /class path. Dates
// read CalendarData's own zone + today (lib/studentZone), never the server's.
export default async function CoursesPage() {
  const user = await requirePageAccess(); // #119 gate, re-run per page (see lib/access)
  const data = await loadCalendarData(user.id);

  return (
    <div className="mx-auto max-w-7xl">
      <h1 className="text-[28px] font-bold tracking-tight text-ink">Courses</h1>
      <p className="mt-1 text-[15px] text-muted">Your grade and what to do next in each course. Open one to see all its work.</p>

      <div className="mt-7">
        {data.connected ? (
          <CourseGrid data={data} />
        ) : (
          <div className="card p-10 text-center">
            <p className="text-[16px] font-medium text-ink">Connect Canvas to see your courses.</p>
            <Link href="/connections" className="btn-primary mt-5 inline-block">
              Connect Canvas
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
