"use client";

// The "Plan" surface — one home for the student's coursework, viewable three ways:
//   • List — the do-next order (importance rank, NEVER the clock). The default,
//     because intelligent ordering is the product's whole value add.
//   • Calendar — the same work laid on a day/week/month grid (when is it due).
//   • Timeline — the Gantt of recommended order by class.
// Merges the old Calendar + Timeline pages so the nav stays lean.

import { useEffect, useState } from "react";
import Link from "next/link";
import { countdownLabel } from "@/lib/calendarDates";
import { shortCourse } from "@/lib/courseName";
import { CalendarView } from "@/components/CalendarView";
import { TimelineView } from "@/components/TimelineView";
import { itemHref, TYPE_LABEL } from "@/lib/itemType";
import type { CalendarData, CalendarItem } from "@/lib/calendarData";

type View = "list" | "calendar" | "timeline";
const VIEWS: { key: View; label: string }[] = [
  { key: "list", label: "List" },
  { key: "calendar", label: "Calendar" },
  { key: "timeline", label: "Timeline" },
];

export function PlanSurface({ data, todayYmd, demo = false, initialView }: { data: CalendarData; todayYmd: string; demo?: boolean; initialView?: View }) {
  const [view, setView] = useState<View>(initialView ?? "list"); // do-next first; sticky pref applied post-mount (skipped in demo)

  useEffect(() => {
    if (initialView) return; // demo controls the view; ignore the saved pref
    try {
      const saved = localStorage.getItem("sp_plan_view");
      if (saved === "list" || saved === "calendar" || saved === "timeline") setView(saved);
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
        <div data-tour="plan-views" role="tablist" aria-label="Plan view" className="flex gap-1 rounded-lg border border-line-subtle bg-surface-soft p-1">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              role="tab"
              aria-selected={v.key === view}
              onClick={() => pick(v.key)}
              className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition ${v.key === view ? "bg-accent text-accent-on" : "text-muted hover:bg-surface"}`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {view === "list" && <PlanList data={data} todayYmd={todayYmd} />}
      {view === "calendar" && <CalendarView data={data} todayYmd={todayYmd} demo defaultView="week" />}
      {view === "timeline" && <TimelineView data={data} />}
    </div>
  );
}

// ── List = the do-next order. A single importance-ranked queue of active work;
// overdue stays in rank (it ranks high on its own) and is simply badged. ─────────
function PlanList({ data, todayYmd }: { data: CalendarData; todayYmd: string }) {
  const rank = new Map(data.ranked.map((r, i) => [r.canvasId, i] as const));
  const byRank = (a: CalendarItem, b: CalendarItem) => (rank.get(a.canvasId) ?? 1e9) - (rank.get(b.canvasId) ?? 1e9);
  const items = data.items.filter((it) => it.status !== "done").sort(byRank);
  const overdue = items.filter((it) => it.status === "overdue").length;

  if (items.length === 0) {
    return <div className="card p-10 text-center text-[16px] text-muted">Nothing on your plate — you&rsquo;re all caught up.</div>;
  }

  return (
    <>
      <p className="mb-3 text-[14px] text-muted">
        {items.length} to do
        {overdue > 0 && (
          <>
            {" · "}
            <span className="font-medium text-danger">{overdue} overdue</span>
          </>
        )}{" "}
        · in the order to tackle them
      </p>
      <div data-tour="plan-list" className="card divide-y divide-line-subtle p-2">
        {items.map((it, i) => (
          <PlanRow key={it.canvasId} item={it} n={i + 1} todayYmd={todayYmd} />
        ))}
      </div>
    </>
  );
}

function PlanRow({ item, n, todayYmd }: { item: CalendarItem; n: number; todayYmd: string }) {
  const overdue = item.status === "overdue";
  return (
    <Link href={itemHref(item.canvasId, item.type, item.status)} className="flex items-center gap-3.5 rounded-lg px-3 py-3 transition hover:bg-surface-soft/60">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent">{n}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-medium text-ink">{item.name}</span>
        <span className="block truncate text-[13px] text-muted">
          {TYPE_LABEL[item.type]} · {shortCourse(item.courseName)}
          {item.pointsPossible != null && item.pointsPossible > 0 ? ` · ${item.pointsPossible} pts` : ""}
        </span>
      </span>
      {overdue ? (
        <span className="shrink-0 rounded-full bg-danger-soft px-2.5 py-0.5 text-[12px] font-medium text-danger">Past due</span>
      ) : item.dueAt ? (
        <span className="shrink-0 text-[14px] font-medium text-ink">{countdownLabel(item.dueAt, todayYmd)}</span>
      ) : null}
    </Link>
  );
}
