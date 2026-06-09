"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { courseColor, pickTextOn } from "@/lib/courseColor";
import { WEEKDAYS, parseYmd } from "@/lib/calendarDates";
import { AttentionBanner, PeriodSummary, ItemDetail, CourseDot, Glyph, ICON } from "@/components/calendar/parts";
import { toneSoft } from "@/lib/tone";
import type { CalendarData, CalendarItem } from "@/lib/calendarData";
import type { PlanDay } from "@/lib/scheduler";

type View = "day" | "week";
const round1 = (n: number) => Math.round(n * 10) / 10;

interface Span {
  canvasId: number;
  name: string;
  hours: number;
  startIdx: number;
  endIdx: number;
  dueIdx: number | null;
  study: boolean;
  lane: number;
}

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Build one continuous bar per assignment for a course: span = first→last day it
 *  has scheduled work, stacked into non-overlapping lanes. */
function buildSpans(days: PlanDay[], course: string): { spans: Span[]; laneCount: number } {
  const acc = new Map<number, { name: string; hours: number; min: number; max: number; study: boolean; dueIso: string }>();
  days.forEach((d, i) => {
    for (const b of d.blocks) {
      if (b.courseName !== course) continue;
      const cur = acc.get(b.canvasId);
      if (cur) {
        cur.hours += b.hours;
        cur.min = Math.min(cur.min, i);
        cur.max = Math.max(cur.max, i);
        if (b.study) cur.study = true;
      } else {
        acc.set(b.canvasId, { name: b.name, hours: b.hours, min: i, max: i, study: !!b.study, dueIso: b.dueAt });
      }
    }
  });

  const spans: Span[] = [...acc.entries()]
    .map(([canvasId, a]) => {
      const dueKey = localYmd(new Date(a.dueIso));
      const dueIdx = days.findIndex((d) => d.date === dueKey);
      return { canvasId, name: a.name, hours: round1(a.hours), startIdx: a.min, endIdx: a.max, dueIdx: dueIdx >= 0 ? dueIdx : null, study: a.study, lane: 0 };
    })
    .sort((x, y) => x.startIdx - y.startIdx || x.endIdx - y.endIdx);

  // First-fit lane packing so overlapping bars stack instead of colliding.
  const laneEnds: number[] = [];
  for (const s of spans) {
    let placed = -1;
    for (let i = 0; i < laneEnds.length; i++) {
      if (laneEnds[i] < s.startIdx) {
        laneEnds[i] = s.endIdx;
        placed = i;
        break;
      }
    }
    if (placed < 0) {
      placed = laneEnds.length;
      laneEnds.push(s.endIdx);
    }
    s.lane = placed;
  }
  return { spans, laneCount: Math.max(1, laneEnds.length) };
}

export function TimelineView({ data }: { data: CalendarData }) {
  const [view, setView] = useState<View>("week");
  const [selected, setSelected] = useState<CalendarItem | null>(null);

  const itemByCanvas = useMemo(() => {
    const m = new Map<number, CalendarItem>();
    for (const it of data.items) m.set(it.canvasId, it);
    return m;
  }, [data.items]);
  const rank = useMemo(() => new Map(data.recommendations.map((r, i) => [r.canvasId, i + 1])), [data.recommendations]);

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
  const pick = (canvasId: number) => {
    const it = itemByCanvas.get(canvasId);
    if (it) setSelected(it);
  };
  const hasWork = courses.length > 0;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Timeline</h1>
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
        <div>
          <AttentionBanner atRisk={data.atRisk} />
          <PeriodSummary view={view === "day" ? "day" : "week"} start={data.plan.days[0]?.date ?? ""} days={view === "day" ? 1 : 7} />

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
            <WeekGantt courses={courses} days={weekDays} rank={rank} onPick={pick} />
          ) : (
            <DaySequence today={data.plan.days[0]} rank={rank} onPick={pick} />
          )}
          <p className="mt-2 text-xs text-muted">The ◆ diamond marks where each item is due · striped “Study” bars are exam &amp; quiz prep · numbers show the recommended order.</p>
        </div>
      )}

      {selected && <ItemDetail item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

const BAR_H = 22; // px per lane row

function WeekGantt({ courses, days, rank, onPick }: { courses: string[]; days: PlanDay[]; rank: Map<number, number>; onPick: (id: number) => void }) {
  const N = days.length;
  const dueDow = (idx: number | null) => (idx != null ? WEEKDAYS[parseYmd(days[idx].date).getDay()] : null);
  return (
    <div className="overflow-x-auto rounded-lg border border-line-subtle">
      <div className="min-w-[640px]">
        {/* Header */}
        <div className="flex bg-surface-soft">
          <div className="w-[150px] shrink-0 px-2 py-1.5 text-xs font-medium text-muted">Class</div>
          <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${N}, 1fr)` }}>
            {days.map((d, i) => {
              const date = parseYmd(d.date);
              return (
                <div key={d.date} className={`border-l border-line-subtle px-1 py-1.5 text-center text-xs ${i === 0 ? "font-semibold text-accent" : "text-muted"}`}>
                  {WEEKDAYS[date.getDay()]} {date.getDate()}
                </div>
              );
            })}
          </div>
        </div>
        {/* Rows */}
        {courses.map((course) => {
          const { spans, laneCount } = buildSpans(days, course);
          const bg = courseColor(course);
          const fg = pickTextOn(bg);
          return (
            <div key={course} className="flex border-t border-line-subtle">
              <div className="sticky left-0 z-10 flex w-[150px] shrink-0 items-center gap-1.5 bg-surface px-2 py-2">
                <span className="h-3.5 w-1 shrink-0 rounded-full" style={{ background: bg }} aria-hidden />
                <span className="truncate text-xs font-medium text-ink" title={course}>
                  {course}
                </span>
              </div>
              <div className="relative flex-1" style={{ height: laneCount * BAR_H + 8 }}>
                {/* today band + day gridlines */}
                <div className="absolute bottom-0 top-0 bg-accent-soft/20" style={{ left: 0, width: `${100 / N}%` }} />
                {days.map((_, i) => (
                  <div key={i} className="absolute bottom-0 top-0 border-l border-line-subtle/60" style={{ left: `${(i / N) * 100}%` }} />
                ))}
                {/* due-date markers — a course-colored diamond + line so it's clear
                    where each assignment / exam / quiz is actually due */}
                {spans
                  .filter((s) => s.dueIdx != null)
                  .map((s) => (
                    <div key={`due-${s.canvasId}`} title={`${s.name} due ${dueDow(s.dueIdx) ?? ""}`}>
                      <div className="absolute bottom-0 top-0 w-px bg-ink/30" style={{ left: `${((s.dueIdx! + 0.5) / N) * 100}%` }} />
                      <span
                        className="absolute h-2.5 w-2.5 rotate-45 rounded-[1px] border border-surface shadow-sm"
                        style={{ left: `calc(${((s.dueIdx! + 0.5) / N) * 100}% - 5px)`, bottom: -2, background: bg }}
                      />
                    </div>
                  ))}
                {/* bars */}
                {spans.map((s) => (
                  <button
                    key={s.canvasId}
                    onClick={() => onPick(s.canvasId)}
                    title={`${s.study ? "Study: " : ""}${s.name} · ${s.hours}h${s.dueIdx != null ? ` · due ${dueDow(s.dueIdx)}` : ""}`}
                    className="absolute truncate rounded px-1.5 text-left text-[10px] font-medium leading-[18px]"
                    style={{
                      left: `${(s.startIdx / N) * 100}%`,
                      width: `calc(${((s.endIdx - s.startIdx + 1) / N) * 100}% - 3px)`,
                      top: s.lane * BAR_H + 4,
                      height: 18,
                      background: bg,
                      color: fg,
                      backgroundImage: s.study ? "repeating-linear-gradient(45deg, rgba(255,255,255,0.28) 0 5px, transparent 5px 10px)" : undefined,
                    }}
                  >
                    {rank.get(s.canvasId) ? <span className="font-bold">{rank.get(s.canvasId)}. </span> : null}
                    {s.study ? "Study: " : ""}
                    {s.name} {s.hours}h
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DaySequence({ today, rank, onPick }: { today?: PlanDay; rank: Map<number, number>; onPick: (id: number) => void }) {
  if (!today || today.blocks.length === 0) {
    return <div className="card p-8 text-center text-sm text-muted">Nothing scheduled today.</div>;
  }
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
            <button onClick={() => onPick(b.canvasId)} className="flex w-full items-center gap-3 rounded-md border border-line-subtle bg-surface px-3 py-2 text-left transition hover:shadow-sm">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{i + 1}</span>
              <span className="h-4 w-1 shrink-0 rounded-full" style={{ background: courseColor(b.courseName) }} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">
                  {b.study ? "Study: " : ""}
                  {b.name}
                </span>
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
