// "Study this week" — a pinned, sideways-scrolling row of the next 7 days' study
// sessions at the top of the Plan page (every width). One chip per session,
// "Mon · Quiz 3 · 45m" (length via fmtHours, the one effort formatter), each opening that test's study page. Renders nothing
// when there are no sessions. The chips come from the pure lib/studyWeek helper.

import Link from "next/link";
import { NavIcon } from "@/components/NavIcon";
import { parseYmd } from "@/lib/calendarDates";
import { fmtHours } from "@/lib/effortFormat";
import { studyChipsFromPlan } from "@/lib/studyWeek";
import type { PlanDay } from "@/lib/scheduler";

export function StudyWeekStrip({ days, todayYmd }: { days: PlanDay[]; todayYmd: string }) {
  const chips = studyChipsFromPlan(days, parseYmd(todayYmd));
  if (chips.length === 0) return null;
  return (
    <section aria-labelledby="study-week-heading" className="mb-5">
      <h2 id="study-week-heading" className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider text-muted">
        <NavIcon name="study" size={14} />
        Study this week
      </h2>
      <ul className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1">
        {chips.map((c, i) => (
          <li key={`${c.date}-${c.canvasId}-${i}`} className="shrink-0 snap-start">
            <Link
              href={`/study/${c.canvasId}`}
              className="max-md:tap inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-accent-soft px-3 py-1.5 text-[13px] font-medium text-accent transition hover:bg-accent-soft/70"
            >
              <span>{c.dayLabel}</span>
              <span aria-hidden>·</span>
              <span className="max-w-[14rem] truncate">{c.title}</span>
              <span aria-hidden>·</span>
              <span>{fmtHours(c.hours)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
