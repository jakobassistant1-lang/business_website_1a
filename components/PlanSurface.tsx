"use client";

// The "Plan" surface — one home for the student's coursework, viewable three ways:
//   • List — the do-next order (importance rank, NEVER the clock). The default,
//     because intelligent ordering is the product's whole value add.
//   • Calendar — the same work laid on a day/week/month grid (when is it due).
//   • Timeline — the Gantt of recommended order by class.
// Merges the old Calendar + Timeline pages so the nav stays lean.
//
// Phones (#39): List only. The view switcher is hidden below `md` and the saved
// preference is never applied there (lib/planView.resolvePlanView) — nor
// overwritten, so a laptop still opens the student's chosen view. Until the
// width is known (server render + first client frame) a skeleton stands in, so a
// phone never mounts Calendar/Timeline (and their sync/briefing effects) at all. The phone List
// adds the week's study sessions, grouped by day, since Calendar/Timeline (where
// they otherwise live) aren't on the phone.

import { useEffect, useState } from "react";
import Link from "next/link";
import { countdownLabel, parseYmd, WEEKDAYS, MONTHS_SHORT } from "@/lib/calendarDates";
import { shortCourse } from "@/lib/courseName";
import { CalendarView } from "@/components/CalendarView";
import { TimelineView } from "@/components/TimelineView";
import { fmtHours, isUpcomingStudy } from "@/components/calendar/parts";
import { itemHref, TYPE_LABEL } from "@/lib/itemType";
import { courseColor } from "@/lib/courseColor";
import { DEFAULT_PLAN_VIEW, isPlanView, resolvePlanView, type PlanViewKey } from "@/lib/planView";
import type { CalendarData, CalendarItem } from "@/lib/calendarData";

export { resolvePlanView };

type View = PlanViewKey;

// Same breakpoint as components/Sheet's useIsPhone (below `md`), but tri-state:
// `null` until the browser has answered, so nothing width-dependent mounts on a guess.
const PHONE_QUERY = "(max-width: 767px)";
function usePhoneKnown(): boolean | null {
  const [phone, setPhone] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const update = () => setPhone(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return phone;
}
const VIEWS: { key: View; label: string }[] = [
  { key: "list", label: "List" },
  { key: "calendar", label: "Calendar" },
  { key: "timeline", label: "Timeline" },
];

export function PlanSurface({ data, todayYmd, demo = false, initialView }: { data: CalendarData; todayYmd: string; demo?: boolean; initialView?: View }) {
  const [view, setView] = useState<View>(initialView ?? DEFAULT_PLAN_VIEW); // calendar default; the saved pref (sp_plan_view) overrides it post-mount
  const phone = usePhoneKnown();
  // What actually renders: the demo's explicit view as given (demo sync is
  // inert); otherwise the preference on tablet/desktop, always the List on a
  // phone, and nothing (a skeleton) until the width is known.
  const shown: View | null = initialView ? view : resolvePlanView(view, phone);

  useEffect(() => {
    if (initialView) return; // demo controls the view; ignore the saved pref
    try {
      const saved = localStorage.getItem("sp_plan_view");
      if (isPlanView(saved)) setView(saved);
    } catch {
      /* ignore */
    }
  }, [initialView]);

  function pick(v: View) {
    setView(v);
    try {
      localStorage.setItem("sp_plan_view", v);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[26px] font-bold tracking-tight text-ink">Plan</h1>
        {/* Hidden below md: phones only get the List, so there's nothing to switch. */}
        <div data-tour="plan-views" role="tablist" aria-label="Plan view" className="hidden gap-1 rounded-lg border border-line-subtle bg-surface-soft p-1 md:flex">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              role="tab"
              aria-selected={v.key === shown}
              onClick={() => pick(v.key)}
              className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition ${v.key === shown ? "bg-accent text-accent-on" : "text-muted hover:bg-surface"}`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {shown === null && <div role="status" aria-busy="true" aria-label="Loading your plan" className="card h-72 animate-pulse bg-surface-soft" />}
      {shown === "list" && <PlanList data={data} todayYmd={todayYmd} isPhone={phone === true} />}
      {shown === "calendar" && <CalendarView data={data} todayYmd={todayYmd} demo={demo} defaultView="week" />}
      {shown === "timeline" && <TimelineView data={data} />}
    </div>
  );
}

// ── List = the do-next order. A single importance-ranked queue of active work;
// overdue stays in rank (it ranks high on its own) and is simply badged. ─────────
function PlanList({ data, todayYmd, isPhone = false }: { data: CalendarData; todayYmd: string; isPhone?: boolean }) {
  const rank = new Map(data.ranked.map((r, i) => [r.canvasId, i] as const));
  const byRank = (a: CalendarItem, b: CalendarItem) => (rank.get(a.canvasId) ?? 1e9) - (rank.get(b.canvasId) ?? 1e9);
  const items = data.items.filter((it) => it.status !== "done").sort(byRank);
  const overdue = items.filter((it) => it.status === "overdue").length;

  if (items.length === 0) {
    return (
      <>
        <div className="card p-10 text-center text-[16px] text-muted">Nothing on your plate — you&rsquo;re all caught up.</div>
        {isPhone && <StudyByDay data={data} todayYmd={todayYmd} />}
      </>
    );
  }

  return (
    <>
      {/* Tour anchor on this short intro line (not the full list card, which can
          exceed viewport height — that oversized cutout pushed the popover off-screen
          on Back). The popover (side:"bottom") points down at the list. */}
      <p data-tour="plan-list" className="mb-3 text-[14px] text-muted">
        {items.length} to do
        {overdue > 0 && (
          <>
            {" · "}
            <span className="font-medium text-muted">{overdue} overdue</span>
          </>
        )}{" "}
        · in the order to tackle them
      </p>
      <div className="card divide-y divide-line-subtle p-2">
        {items.map((it, i) => (
          <PlanRow key={it.canvasId} item={it} n={i + 1} todayYmd={todayYmd} />
        ))}
      </div>
      {isPhone && <StudyByDay data={data} todayYmd={todayYmd} />}
    </>
  );
}

// ── Phone only: the plan's study sessions, grouped by day (they otherwise live in
// the Calendar/Timeline, which phones don't get). Same filter as the dashboard's
// "Today's study" (isUpcomingStudy).
function StudyByDay({ data, todayYmd }: { data: CalendarData; todayYmd: string }) {
  const days = data.plan.days
    .map((d) => ({ date: d.date, blocks: d.blocks.filter((b) => isUpcomingStudy(b, todayYmd)) }))
    .filter((d) => d.blocks.length > 0);
  if (days.length === 0) return null;
  const dayLabel = (date: string) => {
    if (date === todayYmd) return "Today";
    const d = parseYmd(date);
    return `${WEEKDAYS[d.getDay()]}, ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
  };
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">Study sessions</h2>
      <div className="card divide-y divide-line-subtle p-2">
        {days.map((d) => (
          <div key={d.date} className="px-3 py-2">
            <p className={`text-[13px] font-semibold ${d.date === todayYmd ? "text-accent" : "text-muted"}`}>{dayLabel(d.date)}</p>
            <ul>
              {d.blocks.map((b, i) => (
                <li key={`${b.canvasId}-${i}`}>
                  <Link href={`/study/${b.canvasId}`} className="tap flex items-center gap-2.5 text-[15px]">
                    <span className="h-3.5 w-1 shrink-0 rounded-full" style={{ background: courseColor(b.courseName) }} aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-ink">Study: {b.name}</span>
                    <span className="shrink-0 text-[14px] font-medium text-muted">{fmtHours(b.hours)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function PlanRow({ item, n, todayYmd }: { item: CalendarItem; n: number; todayYmd: string }) {
  const overdue = item.status === "overdue";
  return (
    <Link href={itemHref(item.canvasId, item.type, item.status)} className="tap flex items-center gap-3.5 rounded-lg px-3 py-3 transition hover:bg-surface-soft/60">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent">{n}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-medium text-ink">{item.name}</span>
        <span className="block truncate text-[13px] text-muted">
          {TYPE_LABEL[item.type]} · {shortCourse(item.courseName)}
          {item.pointsPossible != null && item.pointsPossible > 0 ? ` · ${item.pointsPossible} pts` : ""}
        </span>
      </span>
      {overdue ? (
        <span className="shrink-0 rounded-full bg-warning-soft px-2.5 py-0.5 text-[12px] font-medium text-warning">Past due</span>
      ) : item.dueAt ? (
        <span className="shrink-0 text-[14px] font-medium text-ink">{countdownLabel(item.dueAt, todayYmd)}</span>
      ) : null}
    </Link>
  );
}
