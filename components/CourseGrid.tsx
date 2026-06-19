"use client";

// The "By class" overview grid — now its own surface (the Courses page) rather
// than a dashboard toggle. Each card is a glanceable overview linking into the
// course's full assignment list at /class/[id].

import Link from "next/link";
import { countdownLabel } from "@/lib/calendarDates";
import { cleanCourse } from "@/lib/courseName";
import type { CalendarData, CalendarItem } from "@/lib/calendarData";

export function CourseGrid({ data, todayYmd }: { data: CalendarData; todayYmd: string }) {
  const byCourse = new Map<number, { name: string; items: CalendarItem[] }>();
  for (const it of data.items) {
    const g = byCourse.get(it.courseCanvasId);
    if (g) g.items.push(it);
    else byCourse.set(it.courseCanvasId, { name: it.courseName, items: [it] });
  }
  for (const it of data.completed) if (!byCourse.has(it.courseCanvasId)) byCourse.set(it.courseCanvasId, { name: it.courseName, items: [] });
  const courses = [...byCourse.entries()].sort((a, b) => cleanCourse(a[1].name).localeCompare(cleanCourse(b[1].name)));

  if (courses.length === 0) {
    return <div className="card p-10 text-center text-[16px] text-muted">No classes synced yet.</div>;
  }
  const rank = new Map(data.ranked.map((r, i) => [r.canvasId, i] as const));
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {courses.map(([id, g], i) => (
        <CourseCard key={id} courseCanvasId={id} courseName={g.name} items={g.items} rank={rank} todayYmd={todayYmd} anchor={i === 0 ? "courses-card" : undefined} />
      ))}
    </div>
  );
}

function CourseCard({ courseCanvasId, courseName, items, rank, todayYmd, anchor }: { courseCanvasId: number; courseName: string; items: CalendarItem[]; rank: Map<number, number>; todayYmd: string; anchor?: string }) {
  const overdue = items.filter((it) => it.status === "overdue").length;
  const normal = items.filter((it) => it.status === "normal");
  // Do-next: the most important item in this class, not the soonest by date.
  const next = normal.slice().sort((a, b) => (rank.get(a.canvasId) ?? 1e9) - (rank.get(b.canvasId) ?? 1e9))[0];

  return (
    <Link
      href={`/class/${courseCanvasId}`}
      data-tour={anchor}
      className="card group flex flex-col p-5 transition hover:border-accent/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-[17px] font-semibold leading-snug text-ink">{cleanCourse(courseName)}</h3>
        {overdue > 0 ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-danger-soft px-2.5 py-1 text-[12px] font-medium text-danger">
            <span className="h-2 w-2 rounded-full bg-danger" aria-hidden /> {overdue} overdue
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-[12px] font-medium text-success">
            <span className="h-2 w-2 rounded-full bg-success" aria-hidden /> On track
          </span>
        )}
      </div>

      {next ? (
        <div className="mt-4">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-muted">Do next</p>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="min-w-0 truncate text-[16px] font-medium text-ink">{next.name}</span>
            {next.dueAt && <span className="shrink-0 text-[14px] font-medium text-accent">{countdownLabel(next.dueAt, todayYmd)}</span>}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-[15px] text-muted">Nothing upcoming.</p>
      )}

      <div className="mt-4 flex items-center justify-between border-t border-line-subtle pt-3 text-[13px]">
        <span className="text-muted">{normal.length} upcoming</span>
        <span className="font-medium text-accent group-hover:underline">View all →</span>
      </div>
    </Link>
  );
}
