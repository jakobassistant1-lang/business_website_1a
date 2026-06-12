"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { pickTextOn } from "@/lib/courseColor";
import { WEEKDAYS, parseYmd } from "@/lib/calendarDates";
import { round1 } from "@/lib/round";
import { AttentionBanner, PeriodSummary, ItemDetail, Glyph, ICON, fmtHours } from "@/components/calendar/parts";
import { TYPE_COLOR, TYPE_LABEL, type ItemType } from "@/lib/itemType";
import type { CalendarData, CalendarItem } from "@/lib/calendarData";
import type { PlanDay } from "@/lib/scheduler";

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
  const pick = (canvasId: number) => {
    const it = itemByCanvas.get(canvasId);
    if (it) setSelected(it);
  };
  const typeOf = (canvasId: number): ItemType => itemByCanvas.get(canvasId)?.type ?? "assignment";
  const hasWork = courses.length > 0;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Timeline</h1>
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
          <PeriodSummary view="week" start={data.plan.days[0]?.date ?? ""} days={7} />

          {!hasWork ? (
            <div className="card p-8 text-center text-sm text-muted">No upcoming work to sequence. You&apos;re clear.</div>
          ) : (
            <>
              <WeekGantt courses={courses} days={weekDays} rank={rank} typeOf={typeOf} onPick={pick} />
              <TimelineLegend />
            </>
          )}
        </div>
      )}

      {selected && <ItemDetail item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

const BAR_H = 30; // px per lane row

function WeekGantt({
  courses,
  days,
  rank,
  typeOf,
  onPick,
}: {
  courses: string[];
  days: PlanDay[];
  rank: Map<number, number>;
  typeOf: (id: number) => ItemType;
  onPick: (id: number) => void;
}) {
  const N = days.length;
  const dueDow = (idx: number | null) => (idx != null ? WEEKDAYS[parseYmd(days[idx].date).getDay()] : null);
  return (
    <div className="overflow-x-auto rounded-lg border border-line-subtle">
      <div className="min-w-[720px]">
        {/* Header */}
        <div className="flex bg-surface-soft">
          <div className="w-[160px] shrink-0 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">Class</div>
          <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${N}, 1fr)` }}>
            {days.map((d, i) => {
              const date = parseYmd(d.date);
              return (
                <div key={d.date} className={`border-l border-line-subtle px-1 py-2 text-center text-sm ${i === 0 ? "font-semibold text-accent" : "text-muted"}`}>
                  {WEEKDAYS[date.getDay()]} {date.getDate()}
                </div>
              );
            })}
          </div>
        </div>
        {/* Rows */}
        {courses.map((course) => {
          const { spans, laneCount } = buildSpans(days, course);
          return (
            <div key={course} className="flex border-t border-line-subtle">
              <div className="sticky left-0 z-10 flex w-[160px] shrink-0 items-center bg-surface px-3 py-2">
                <span className="truncate text-sm font-medium text-ink" title={course}>
                  {course}
                </span>
              </div>
              <div className="relative flex-1" style={{ height: laneCount * BAR_H + 10 }}>
                {/* today band + day gridlines */}
                <div className="absolute bottom-0 top-0 bg-accent-soft/20" style={{ left: 0, width: `${100 / N}%` }} />
                {days.map((_, i) => (
                  <div key={i} className="absolute bottom-0 top-0 border-l border-line-subtle/60" style={{ left: `${(i / N) * 100}%` }} />
                ))}
                {/* due-date markers — a type-colored diamond + line so it's clear where
                    each assignment / exam / quiz is actually due */}
                {spans
                  .filter((s) => s.dueIdx != null)
                  .map((s) => {
                    const c = TYPE_COLOR[typeOf(s.canvasId)];
                    return (
                      <div key={`due-${s.canvasId}`} title={`${s.name} due ${dueDow(s.dueIdx) ?? ""}`}>
                        <div className="absolute bottom-0 top-0 w-px bg-ink/30" style={{ left: `${((s.dueIdx! + 0.5) / N) * 100}%` }} />
                        <span
                          className="absolute h-3.5 w-3.5 rotate-45 rounded-[2px] border border-surface shadow-sm"
                          style={{ left: `calc(${((s.dueIdx! + 0.5) / N) * 100}% - 7px)`, bottom: -3, background: c }}
                        />
                      </div>
                    );
                  })}
                {/* bars — colored by assignment TYPE (not class); the class is the row */}
                {spans.map((s) => {
                  const c = TYPE_COLOR[typeOf(s.canvasId)];
                  const fg = pickTextOn(c);
                  return (
                    <button
                      key={s.canvasId}
                      onClick={() => onPick(s.canvasId)}
                      title={`${s.study ? "Study: " : ""}${s.name} · ${fmtHours(s.hours)}${s.dueIdx != null ? ` · due ${dueDow(s.dueIdx)}` : ""}`}
                      className="absolute truncate rounded px-2 text-left text-xs font-medium leading-[26px]"
                      style={{
                        left: `${(s.startIdx / N) * 100}%`,
                        width: `calc(${((s.endIdx - s.startIdx + 1) / N) * 100}% - 3px)`,
                        top: s.lane * BAR_H + 5,
                        height: 26,
                        background: c,
                        color: fg,
                        backgroundImage: s.study ? "repeating-linear-gradient(45deg, rgba(255,255,255,0.30) 0 5px, transparent 5px 10px)" : undefined,
                      }}
                    >
                      {rank.get(s.canvasId) ? <span className="font-bold">{rank.get(s.canvasId)}. </span> : null}
                      {s.study ? "Study: " : ""}
                      {s.name} {fmtHours(s.hours)}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Visual key for the timeline: the four type colors + the due diamond, study
 *  stripes, and the recommended-order number. */
function TimelineLegend() {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-line-subtle bg-surface-soft px-3 py-2 text-xs text-muted">
      <span className="text-xs font-semibold uppercase tracking-wide text-ink">Key</span>
      {(["assignment", "quiz", "exam", "other"] as ItemType[]).map((t) => (
        <span key={t} className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-[3px]" style={{ background: TYPE_COLOR[t] }} aria-hidden /> {TYPE_LABEL[t]}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rotate-45 rounded-[2px] border border-line bg-ink/40" aria-hidden /> due date
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="h-3 w-6 rounded-[2px]"
          style={{ backgroundImage: "repeating-linear-gradient(45deg, rgb(var(--accent)) 0 4px, rgb(var(--accent) / 0.45) 4px 8px)" }}
          aria-hidden
        />{" "}
        study (exam / quiz prep)
      </span>
      <span className="flex items-center gap-1.5">
        <span className="font-bold text-ink">1.</span> recommended order
      </span>
    </div>
  );
}
