"use client";

// The "By course" overview grid — its own surface (the Courses page, /courses).
// Each card leads with the student's real Canvas grade (the thing the old page
// lacked and Canvas itself buries), then the do-next item, and links into the
// course's full assignment list at /class/[id].
//
// Every count and the "Do next" pick come from lib/courseCounts — the SAME split
// the course page lists — so a card can never say "Nothing upcoming." beside
// "3 upcoming". Dates are read in the student's Canvas zone (CalendarData.timeZone).
//
// Card = a `div.relative`; the title <Link> stretches over the whole card with an
// `after:` overlay, and the course menu is a SIBLING (`relative z-10`) — never a
// control nested inside a link (#141).

import Link from "next/link";
import { relativeDay } from "@/lib/calendarDates";
import { dataToday, dataZone } from "@/lib/studentZone";
import { courseBuckets, countsOf, doNext } from "@/lib/courseCounts";
import { cleanCourse } from "@/lib/courseName";
import { EffortTag } from "@/components/calendar/parts";
import { CourseMenu, ExcludedCoursesRow } from "@/components/CourseExclude";
import { CourseCarousel } from "@/components/CourseCarousel";
import { GradePill } from "@/components/GradePill";
import { DueLabel } from "@/components/DueLabel";
import type { CalendarData, CalendarItem, CourseMeta } from "@/lib/calendarData";

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 5a2 2 0 0 1 4 0 7 7 0 0 1 4 6v3a4 4 0 0 0 2 3H4a4 4 0 0 0 2-3v-3a7 7 0 0 1 4-6" />
      <path d="M9 17v1a3 3 0 0 0 6 0v-1" />
    </svg>
  );
}

export function CourseGrid({ data, demo = false }: { data: CalendarData; demo?: boolean }) {
  const timeZone = dataZone(data);
  const todayYmd = dataToday(data);
  const byCourse = new Map<number, { name: string; items: CalendarItem[]; completed: CalendarItem[] }>();
  const group = (it: CalendarItem) => {
    const g = byCourse.get(it.courseCanvasId);
    if (g) return g;
    const fresh = { name: it.courseName, items: [] as CalendarItem[], completed: [] as CalendarItem[] };
    byCourse.set(it.courseCanvasId, fresh);
    return fresh;
  };
  for (const it of data.items) group(it).items.push(it);
  for (const it of data.completed) group(it).completed.push(it);
  const courses = [...byCourse.entries()].sort((a, b) => cleanCourse(a[1].name).localeCompare(cleanCourse(b[1].name)));
  // Excluded courses have no items (filtered at the data chokepoint) — they live
  // only in the quiet dashed row below, which is also the undo.
  const excluded = data.courses.filter((c) => c.excluded);

  if (courses.length === 0 && excluded.length === 0) {
    return <div className="card p-10 text-center text-[16px] text-muted">No courses synced yet.</div>;
  }
  const rankedIds = data.ranked.map((r) => r.canvasId);
  const metaByCourse = new Map(data.courses.map((c) => [c.canvasId, c] as const));
  const cards = courses.map(([id, g], i) => (
    <CourseCard key={id} courseCanvasId={id} courseName={g.name} items={g.items} completed={g.completed} meta={metaByCourse.get(id)} rankedIds={rankedIds} todayYmd={todayYmd} timeZone={timeZone} anchor={i === 0 ? "courses-card" : undefined} demo={demo} />
  ));
  return (
    <>
      {courses.length === 0 ? (
        <div className="card p-10 text-center text-[16px] text-muted">All your courses are excluded from planning.</div>
      ) : (
        <>
          {/* Phones: a swipeable one-card carousel. md+: the grid as before. Both
              are in the DOM and CSS picks one (no first-paint swap); the tour
              anchor on each first card resolves to whichever is shown. */}
          <div className="md:hidden">
            <CourseCarousel>{cards}</CourseCarousel>
          </div>
          <div className="hidden md:grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">{cards}</div>
        </>
      )}
      <ExcludedCoursesRow courses={excluded} demo={demo} />
    </>
  );
}

function CourseCard({ courseCanvasId, courseName, items, completed, meta, rankedIds, todayYmd, timeZone, anchor, demo }: { courseCanvasId: number; courseName: string; items: CalendarItem[]; completed: CalendarItem[]; meta: CourseMeta | undefined; rankedIds: number[]; todayYmd: string; timeZone: string; anchor?: string; demo?: boolean }) {
  const counts = countsOf(courseBuckets(items, completed, rankedIds));
  // Do next: the top-RANKED actionable item (past due included — the Focus rule),
  // drawn from exactly the lists counted above, so it exists whenever a count does.
  const next = doNext(items, completed, rankedIds);

  return (
    <div
      data-tour={anchor}
      className="card group relative flex flex-col p-5 transition hover:border-accent/40 hover:shadow-md has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-accent"
    >
      {/* Wraps at every width: the title keeps at least 12rem, so in a narrow grid column the
          grade pill + menu drop below it instead of squeezing "MANAGERIAL ECONOMICS" into a clamp. */}
      <div className="flex flex-wrap items-start justify-between gap-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-[12rem]">
          {/* Always two lines tall (`2lh`), so a one-line title's "Do next"
              row lines up with its neighbours'. */}
          <h2 className="line-clamp-2 min-h-[2lh] break-words text-[17px] font-semibold leading-snug text-ink">
            <Link href={`/class/${courseCanvasId}`} className="after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none">
              {cleanCourse(courseName)}
            </Link>
          </h2>
          <p className="mt-1 text-[12px] font-medium">
            {counts.pastDue > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden /> {counts.pastDue} past due
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden /> On track
              </span>
            )}
          </p>
        </div>
        <span className="relative z-10 flex shrink-0 items-center gap-1.5">
          {meta && <GradePill grade={meta.grade} />}
          {!demo && <CourseMenu courseCanvasId={courseCanvasId} />}
        </span>
      </div>

      {next ? (
        <div className="mt-4">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-muted">Do next</p>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="min-w-0 truncate text-[16px] font-medium text-ink">{next.name}</span>
            {next.dueAt && (
              <DueLabel iso={next.dueAt} format="countdown" todayYmd={todayYmd} timeZone={timeZone} className={`shrink-0 text-[14px] font-medium ${next.status === "overdue" ? "text-warning" : "text-accent"}`} />
            )}
            <EffortTag hours={next.estimatedEffortHours} className="shrink-0 self-center" />
          </div>
        </div>
      ) : (
        <p className="mt-4 text-[15px] text-muted">{counts.notOpenYet > 0 ? "Nothing to do until the next one opens." : "Nothing upcoming."}</p>
      )}

      {meta?.latestAnnouncement && (
        <div className="mt-4 flex items-center gap-2 text-[13px] text-muted" title={meta.latestAnnouncement.title}>
          <BellIcon />
          <span className="min-w-0 flex-1 truncate">{meta.latestAnnouncement.title}</span>
          <span className="shrink-0">{relativeDay(meta.latestAnnouncement.postedAt, todayYmd, timeZone)}</span>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between border-t border-line-subtle pt-3 text-[13px]">
        <span className="text-muted">{counts.upcoming} upcoming</span>
        <span className="font-medium text-accent group-hover:underline" aria-hidden>
          View all →
        </span>
      </div>
    </div>
  );
}
