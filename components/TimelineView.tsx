"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { courseColor, pickTextOn } from "@/lib/courseColor";
import { WEEKDAYS } from "@/lib/calendarDates";
import { AttentionBanner, PeriodSummary, ItemDetail, CourseDot, Glyph, ICON } from "@/components/calendar/parts";
import { toneSoft } from "@/lib/tone";
import type { CalendarData, CalendarItem } from "@/lib/calendarData";
import type { DayBlock, PlanDay } from "@/lib/scheduler";

type View = "day" | "week";

function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function sameYmd(a: Date, b: string): boolean {
  return `${a.getFullYear()}-${String(a.getMonth() + 1).padStart(2, "0")}-${String(a.getDate()).padStart(2, "0")}` === b;
}

export function TimelineView({ data }: { data: CalendarData }) {
  const [view, setView] = useState<View>("week");
  const [selected, setSelected] = useState<CalendarItem | null>(null);

  const itemByCanvas = useMemo(() => {
    const m = new Map<number, CalendarItem>();
    for (const it of data.items) m.set(it.canvasId, it);
    return m;
  }, [data.items]);

  // Global recommended order → a 1-based rank per assignment (the "sequence spine").
  const rank = useMemo(() => new Map(data.recommendations.map((r, i) => [r.canvasId, i + 1])), [data.recommendations]);

  // Courses that have scheduled work, ordered by their earliest due date (most urgent on top).
  const courses = useMemo(() => {
    const earliest = new Map<string, number>();
    for (const d of data.plan.days)
      for (const b of d.blocks) {
        const t = new Date(b.dueAt).getTime();
        earliest.set(b.courseName, Math.min(earliest.get(b.courseName) ?? Infinity, t));
      }
    return [...earliest.entries()].sort((a, b) => a[1] - b[1]).map(([name]) => name);
  }, [data.plan.days]);

  const weekDays = data.plan.days.slice(0, 7);
  const overdue = data.atRisk.filter((a) => a.kind === "overdue");

  const onBar = (b: DayBlock) => {
    const it = itemByCanvas.get(b.canvasId);
    if (it) setSelected(it);
  };

  const hasWork = courses.length > 0;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Timeline</h1>
          <p className="mt-1 text-sm text-muted">Your recommended order of work, by class</p>
        </div>
        <div role="tablist" className="flex gap-1 rounded-lg border border-line-subtle bg-surface-soft p-1">
          {(["day", "week"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={v === view}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1 text-sm font-medium capitalize transition ${v === view ? "bg-accent text-accent-on" : "text-muted hover:bg-surface"}`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {!data.connected ? (
        <div className="card mt-6 p-8 text-center">
          <div className="flex justify-center text-accent">
            <Glyph d={ICON.list} size={32} />
          </div>
          <p className="mt-3 text-sm font-medium text-ink">Nothing to sequence yet.</p>
          <p className="mt-1 text-sm text-muted">Connect Canvas and your work will line up here in a recommended order.</p>
          <Link href="/connections" className="btn-primary mt-4">
            Connect Canvas
          </Link>
        </div>
      ) : (
        <div className="mt-6">
          <AttentionBanner atRisk={data.atRisk} />
          <PeriodSummary view={view === "day" ? "day" : "week"} start={data.plan.days[0]?.date ?? ""} days={view === "day" ? 1 : 7} />

          {/* PAST DUE lane — always first so overdue work is never lost. */}
          {overdue.length > 0 && (
            <div className="mb-4 rounded-lg border border-danger/40 bg-danger-soft/40 p-3">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-danger">Past due</p>
              <div className="space-y-1.5">
                {overdue.map((a) => (
                  <div key={`pd-${a.canvasId}`} className="flex items-center justify-between gap-2 rounded-md bg-surface px-2 py-1.5">
                    <span className="flex min-w-0 items-center gap-1.5 text-sm text-ink">
                      <CourseDot name={a.courseName} />
                      <span className="truncate">{a.name}</span>
                    </span>
                    {a.htmlUrl && (
                      <a href={a.htmlUrl} target="_blank" rel="noreferrer" className="shrink-0 text-xs font-medium text-danger hover:underline">
                        Open ↗
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!hasWork ? (
            <div className="card p-8 text-center text-sm text-muted">No upcoming work to sequence. You&apos;re clear.</div>
          ) : view === "week" ? (
            <WeekGantt courses={courses} days={weekDays} rank={rank} onBar={onBar} />
          ) : (
            <DaySequence today={data.plan.days[0]} rank={rank} onBar={onBar} />
          )}
        </div>
      )}

      {selected && <ItemDetail item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function WeekGantt({
  courses,
  days,
  rank,
  onBar,
}: {
  courses: string[];
  days: PlanDay[];
  rank: Map<number, number>;
  onBar: (b: DayBlock) => void;
}) {
  const cols = `150px repeat(${days.length}, minmax(76px, 1fr))`;
  return (
    <div className="overflow-x-auto rounded-lg border border-line-subtle">
      <div className="min-w-[620px]">
        {/* Header */}
        <div className="grid bg-surface-soft" style={{ gridTemplateColumns: cols }}>
          <div className="px-2 py-1.5 text-xs font-medium text-muted">Class</div>
          {days.map((d, i) => {
            const date = parseYmd(d.date);
            const today = i === 0;
            return (
              <div key={d.date} className={`border-l border-line-subtle px-1 py-1.5 text-center text-xs ${today ? "font-semibold text-accent" : "text-muted"}`}>
                {WEEKDAYS[date.getDay()]} {date.getDate()}
              </div>
            );
          })}
        </div>
        {/* Rows */}
        {courses.map((course) => {
          const bg = courseColor(course);
          const fg = pickTextOn(bg);
          return (
            <div key={course} className="grid border-t border-line-subtle" style={{ gridTemplateColumns: cols }}>
              <div className="sticky left-0 z-10 flex items-center gap-1.5 bg-surface px-2 py-1.5">
                <span className="h-3.5 w-1 shrink-0 rounded-full" style={{ background: bg }} aria-hidden />
                <span className="truncate text-xs font-medium text-ink" title={course}>
                  {course}
                </span>
              </div>
              {days.map((d) => {
                const date = parseYmd(d.date);
                const blocks = d.blocks.filter((b) => b.courseName === course);
                return (
                  <div key={`${course}-${d.date}`} className="min-h-[2.25rem] space-y-0.5 border-l border-line-subtle p-0.5">
                    {blocks.map((b, i) => {
                      const due = sameYmd(date, b.dueAt.slice(0, 10));
                      const r = rank.get(b.canvasId);
                      return (
                        <button
                          key={`${b.canvasId}-${i}`}
                          onClick={() => onBar(b)}
                          title={`${b.name} · ${b.hours}h${due ? " · due today" : ""}`}
                          className="block w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-medium"
                          style={{ background: bg, color: fg }}
                        >
                          {r ? <span className="font-bold">{r}. </span> : null}
                          {b.name} {b.hours}h{due ? " ◆" : ""}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DaySequence({ today, rank, onBar }: { today?: PlanDay; rank: Map<number, number>; onBar: (b: DayBlock) => void }) {
  if (!today || today.blocks.length === 0) {
    return <div className="card p-8 text-center text-sm text-muted">Nothing scheduled today.</div>;
  }
  // Order today's blocks by recommended rank, then by due time.
  const blocks = [...today.blocks].sort((a, b) => {
    const ra = rank.get(a.canvasId) ?? 999;
    const rb = rank.get(b.canvasId) ?? 999;
    if (ra !== rb) return ra - rb;
    return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
  });
  return (
    <div className="card p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Today&apos;s order</p>
      <ol className="space-y-2">
        {blocks.map((b, i) => (
          <li key={`${b.canvasId}-${i}`}>
            <button onClick={() => onBar(b)} className="flex w-full items-center gap-3 rounded-md border border-line-subtle bg-surface px-3 py-2 text-left transition hover:shadow-sm">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{i + 1}</span>
              <span className="h-4 w-1 shrink-0 rounded-full" style={{ background: courseColor(b.courseName) }} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{b.name}</span>
                <span className="block truncate text-xs text-muted">{b.courseName}</span>
              </span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${toneSoft.neutral}`}>{b.hours}h</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
