"use client";

// The "By class" overview grid — its own surface (the Courses page). Each card
// leads with the student's real Canvas grade (the thing the old page lacked and
// Canvas itself buries), then the do-next item, and links into the course's full
// assignment list at /class/[id].

import Link from "next/link";
import { countdownLabel, relativeDay } from "@/lib/calendarDates";
import { cleanCourse } from "@/lib/courseName";
import { EffortTag } from "@/components/calendar/parts";
import { CourseMenu, ExcludedCoursesRow } from "@/components/CourseExclude";
import { GradePill } from "@/components/GradePill";
import type { CalendarData, CalendarItem, CourseMeta } from "@/lib/calendarData";

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 5a2 2 0 0 1 4 0 7 7 0 0 1 4 6v3a4 4 0 0 0 2 3H4a4 4 0 0 0 2-3v-3a7 7 0 0 1 4-6" />
      <path d="M9 17v1a3 3 0 0 0 6 0v-1" />
    </svg>
  );
}

export function CourseGrid({ data, todayYmd, demo = false }: { data: CalendarData; todayYmd: string; demo?: boolean }) {
  const byCourse = new Map<number, { name: string; items: CalendarItem[] }>();
  for (const it of data.items) {
    const g = byCourse.get(it.courseCanvasId);
    if (g) g.items.push(it);
    else byCourse.set(it.courseCanvasId, { name: it.courseName, items: [it] });
  }
  for (const it of data.completed) if (!byCourse.has(it.courseCanvasId)) byCourse.set(it.courseCanvasId, { name: it.courseName, items: [] });
  const courses = [...byCourse.entries()].sort((a, b) => cleanCourse(a[1].name).localeCompare(cleanCourse(b[1].name)));
  // Excluded classes have no items (filtered at the data chokepoint) — they live
  // only in the quiet dashed row below, which is also the undo.
  const excluded = data.courses.filter((c) => c.excluded);

  if (courses.length === 0 && excluded.length === 0) {
    return <div className="card p-10 text-center text-[16px] text-muted">No classes synced yet.</div>;
  }
  const rank = new Map(data.ranked.map((r, i) => [r.canvasId, i] as const));
  const metaByCourse = new Map(data.courses.map((c) => [c.canvasId, c] as const));
  return (
    <>
      {courses.length === 0 ? (
        <div className="card p-10 text-center text-[16px] text-muted">All your classes are excluded from planning.</div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {courses.map(([id, g], i) => (
            <CourseCard key={id} courseCanvasId={id} courseName={g.name} items={g.items} meta={metaByCourse.get(id)} rank={rank} todayYmd={todayYmd} anchor={i === 0 ? "courses-card" : undefined} demo={demo} />
          ))}
        </div>
      )}
      <ExcludedCoursesRow courses={excluded} demo={demo} />
    </>
  );
}

function CourseCard({ courseCanvasId, courseName, items, meta, rank, todayYmd, anchor, demo }: { courseCanvasId: number; courseName: string; items: CalendarItem[]; meta: CourseMeta | undefined; rank: Map<number, number>; todayYmd: string; anchor?: string; demo?: boolean }) {
  const overdue = items.filter((it) => it.status === "overdue").length;
  const normal = items.filter((it) => it.status === "normal");
  // Do-next: the most important RANKED item in this class, not the soonest by
  // date. Items outside the ranking (AI-screened placeholders like attendance /
  // participation columns) must never be suggested as something to "do" — a
  // class whose only remaining items are screened shows "Nothing upcoming".
  const next = normal.filter((it) => rank.has(it.canvasId)).sort((a, b) => rank.get(a.canvasId)! - rank.get(b.canvasId)!)[0];

  return (
    <Link
      href={`/class/${courseCanvasId}`}
      data-tour={anchor}
      className="card group flex flex-col p-5 transition hover:border-accent/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[17px] font-semibold leading-snug text-ink">{cleanCourse(courseName)}</h3>
          <p className="mt-1 text-[12px] font-medium">
            {overdue > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden /> {overdue} overdue
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden /> On track
              </span>
            )}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          {meta && <GradePill grade={meta.grade} />}
          {!demo && <CourseMenu courseCanvasId={courseCanvasId} />}
        </span>
      </div>

      {next ? (
        <div className="mt-4">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-muted">Do next</p>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="min-w-0 truncate text-[16px] font-medium text-ink">{next.name}</span>
            {next.dueAt && <span className="shrink-0 text-[14px] font-medium text-accent">{countdownLabel(next.dueAt, todayYmd)}</span>}
            <EffortTag hours={next.estimatedEffortHours} className="shrink-0 self-center" />
          </div>
        </div>
      ) : (
        <p className="mt-4 text-[15px] text-muted">Nothing upcoming.</p>
      )}

      {meta?.latestAnnouncement && (
        <div className="mt-4 flex items-center gap-2 text-[13px] text-muted" title={meta.latestAnnouncement.title}>
          <BellIcon />
          <span className="min-w-0 flex-1 truncate">{meta.latestAnnouncement.title}</span>
          <span className="shrink-0">{relativeDay(meta.latestAnnouncement.postedAt, todayYmd)}</span>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between border-t border-line-subtle pt-3 text-[13px]">
        <span className="text-muted">{normal.length} upcoming</span>
        <span className="font-medium text-accent group-hover:underline">View all →</span>
      </div>
    </Link>
  );
}
