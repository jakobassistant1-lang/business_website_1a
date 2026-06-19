import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { loadCalendarData } from "@/lib/calendarData";
import { ymd } from "@/lib/calendarDates";
import { CourseGrid } from "@/components/CourseGrid";

export const dynamic = "force-dynamic";

// /courses — the by-class overview, promoted from a dashboard toggle to its own
// discoverable surface. Cards link into each course's full list at /class/[id].
export default async function CoursesPage() {
  const user = await getCurrentUser(); // layout guarantees auth
  const data = await loadCalendarData(user!.id);

  return (
    <div className="mx-auto max-w-7xl">
      <h1 className="text-[28px] font-bold tracking-tight text-ink">Courses</h1>
      <p className="mt-1 text-[15px] text-muted">Your classes at a glance — open one for its full assignment list.</p>

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
