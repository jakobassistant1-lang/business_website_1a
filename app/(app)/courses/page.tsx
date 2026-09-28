import Link from "next/link";
import { requirePageAccess } from "@/lib/access";
import { loadCalendarData } from "@/lib/calendarData";
import { ymd } from "@/lib/calendarDates";
import { CourseGrid } from "@/components/CourseGrid";

export const dynamic = "force-dynamic";

// /courses — the "Classes" page: the by-class overview, promoted from a dashboard
// toggle to its own surface. Cards link into each class's full list at
// /class/[id]. User-facing copy says "Classes" everywhere (owner, #141); the
// route keeps its old path.
export default async function CoursesPage() {
  const user = await requirePageAccess(); // #119 gate, re-run per page (see lib/access)
  const data = await loadCalendarData(user.id);

  return (
    <div className="mx-auto max-w-7xl">
      <h1 className="text-[28px] font-bold tracking-tight text-ink">Classes</h1>
      <p className="mt-1 text-[15px] text-muted">Your grade and what to do next in each class. Open one to see all its work.</p>

      <div className="mt-7">
        {data.connected ? (
          <CourseGrid data={data} todayYmd={ymd(new Date())} />
        ) : (
          <div className="card p-10 text-center">
            <p className="text-[16px] font-medium text-ink">Connect Canvas to see your classes.</p>
            <Link href="/connections" className="btn-primary mt-5 inline-block">
              Connect Canvas
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
