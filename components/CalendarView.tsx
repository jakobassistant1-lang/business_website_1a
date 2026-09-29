"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useAutoSync } from "@/components/useAutoSync";
import { useIsPhone } from "@/components/Sheet";
import { DueLabel } from "@/components/DueLabel";
import { SyncStatus } from "@/components/SyncStatus";
import { shortCourse } from "@/lib/courseName";
import { dataZone } from "@/lib/studentZone";
import { isStudySessionBlock } from "@/lib/studyWeek";
import {
  startOfDay,
  addDays,
  ymd,
  ymdInZone,
  parseYmd,
  sameDay,
  monthGrid,
  rangeForView,
  rangeLabel,
  WEEKDAYS,
} from "@/lib/calendarDates";
import {
  AttentionBanner,
  PeriodSummary,
  PeriodToolbar,
  ItemPill,
  BusyRow,
  ItemDetail,
  DayPeek,
  CourseDot,
  Glyph,
  ICON,
  fmtHours,
} from "@/components/calendar/parts";
import { formatDay } from "@/lib/dueLabel";
import { courseColor } from "@/lib/courseColor";
import type { CalendarData, CalendarItem } from "@/lib/calendarData";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { PlanDay } from "@/lib/scheduler";

type View = "day" | "week" | "month";

// Month grid column heads, Monday first — derived from the shared WEEKDAYS
// (single source), matching monthGrid's Monday start.
const WEEKDAYS_MON_FIRST = [...WEEKDAYS.slice(1), WEEKDAYS[0]];

/** "Wednesday, Sep 30" — the accessible name of a day control and the Day
 *  view's heading: lib/dueLabel's "day" format (`d` is a calendar day). */
function fullDate(d: Date): string {
  return formatDay(ymd(d));
}

/** `?view=&date=` → the Calendar's place (nulls for anything missing or
 *  malformed), so a refresh or shared link reopens the same view and day. */
export function calendarPlaceFromSearch(search: string): { view: View | null; date: string | null } {
  const p = new URLSearchParams(search);
  const v = p.get("view");
  const d = p.get("date");
  return {
    view: v === "day" || v === "week" || v === "month" ? v : null,
    date: d && /^\d{4}-\d{2}-\d{2}$/.test(d) && ymd(parseYmd(d)) === d ? d : null,
  };
}

/** Write the Calendar's place into the current URL (replaceState: moving around
 *  the calendar isn't a history step). `view: null` clears both params — PlanSurface
 *  calls that when the student leaves the Calendar for List/Timeline. `date` is
 *  dropped when it's today, so the everyday URL stays clean. */
export function writeCalendarPlace(view: View | null, date?: string, todayYmd?: string): void {
  const url = new URL(window.location.href);
  if (view) url.searchParams.set("view", view);
  else url.searchParams.delete("view");
  if (view && date && date !== todayYmd) url.searchParams.set("date", date);
  else url.searchParams.delete("date");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function group<T>(arr: T[], key: (t: T) => string | null): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const t of arr) {
    const k = key(t);
    if (k === null) continue;
    const a = m.get(k);
    if (a) a.push(t);
    else m.set(k, [t]);
  }
  return m;
}

export function CalendarView({ data, todayYmd, demo = false, defaultView = "day" }: { data: CalendarData; todayYmd: string; demo?: boolean; defaultView?: View }) {
  // "Today" is the student's day in their Canvas zone (PlanSurface passes
  // dataToday(data)), and every due instant is bucketed into a day in that SAME
  // zone (lib/studentZone) — identical on the server and in any browser.
  const zone = dataZone(data);
  const [now] = useState(() => parseYmd(todayYmd));
  // The view and anchor day live in the URL (`?view=week&date=2026-09-30`) so a
  // refresh keeps the place. Read in the initializers, so the first frame and the
  // first briefing fetch already use the right range. Hydration-safe: outside the
  // demo, PlanSurface mounts CalendarView client-side only (after it knows the
  // width), so there's no server render to disagree with; the demo (which can
  // server-render it) never reads the URL.
  const [urlPlace] = useState(() =>
    !demo && typeof window !== "undefined" ? calendarPlaceFromSearch(window.location.search) : { view: null, date: null },
  );
  const [view, setView] = useState<View>(urlPlace.view ?? defaultView);
  const [anchor, setAnchor] = useState(() => parseYmd(urlPlace.date ?? todayYmd));
  const [selected, setSelected] = useState<CalendarItem | null>(null);
  const [peek, setPeek] = useState<Date | null>(null);
  const [showCompleted, setShowCompleted] = useState(true);
  const phone = useIsPhone(); // behaviour only (sheet stacking), never layout
  // Canvas auto-sync (full on mount when stale, quick refresh on tab return) +
  // the manual Sync button — one policy, in components/useAutoSync.
  const { status: syncInputs, runManual: runSync } = useAutoSync({ connected: data.connected, syncedAt: data.syncedAt, lastCheckedAt: data.lastCheckedAt, stale: data.stale, demo });

  const itemsByDay = useMemo(() => {
    const m = group(data.items, (it) => (it.dueAt ? ymdInZone(it.dueAt, zone) : null));
    for (const arr of m.values()) arr.sort((a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime());
    return m;
  }, [data.items, zone]);
  const eventsByDay = useMemo(() => group(data.events, (ev) => ymdInZone(ev.startTime, zone)), [data.events, zone]);
  const planByDay = useMemo(() => {
    const m = new Map<string, PlanDay>();
    for (const d of data.plan.days) m.set(d.date, d);
    return m;
  }, [data.plan.days]);
  const undated = useMemo(() => data.items.filter((it) => !it.dueAt), [data.items]);

  // Written only when the student moves. The demo owns its own URL.
  function goTo(nextView: View, nextAnchor: Date) {
    setView(nextView);
    setAnchor(nextAnchor);
    if (!demo) writeCalendarPlace(nextView, ymd(nextAnchor), todayYmd);
  }

  // Week is a rolling 7 days from the anchor (lib/calendarDates.rangeForView), so
  // ‹ › step 7 days and "Today" puts today in the first column.
  function navigate(dir: -1 | 1) {
    if (view === "day") goTo(view, addDays(anchor, dir));
    else if (view === "week") goTo(view, addDays(anchor, dir * 7));
    else goTo(view, new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1));
  }
  function openDay(d: Date) {
    goTo("day", startOfDay(d));
  }

  const atToday =
    view === "month" ? anchor.getMonth() === now.getMonth() && anchor.getFullYear() === now.getFullYear() : sameDay(anchor, now);
  const { start, days } = rangeForView(view, anchor);

  return (
    <div>
      {/* Header — THE sync indicator (one state at a time) + its action; the
          "Plan" title + tabs live in the parent PlanSurface. */}
      <SyncStatus className="mb-3" inputs={syncInputs} onRetry={data.connected ? runSync : undefined} manual />

      {!data.connected ? (
        <div className="card mt-6 p-8 text-center">
          <div className="flex justify-center text-accent">
            <Glyph d={ICON.calendar} size={32} />
          </div>
          <p className="mt-3 text-sm font-medium text-ink">Let&apos;s build your calendar.</p>
          <p className="mt-1 text-sm text-muted">Connect your Canvas account and your coursework will appear here.</p>
          <Link href="/connections" className="btn-primary mt-4">
            Connect Canvas
          </Link>
        </div>
      ) : (
        <div>
          <AttentionBanner atRisk={data.atRisk} />
          <PeriodToolbar
            view={view}
            views={["day", "week", "month"]}
            onView={(v) => goTo(v as View, anchor)}
            label={rangeLabel(view, anchor, now)}
            onPrev={() => navigate(-1)}
            onNext={() => navigate(1)}
            onToday={() => goTo(view, now)}
            atToday={atToday}
          />
          <PeriodSummary view={view} start={ymd(start)} days={days} />

          {view === "day" && (
            <DayView
              date={anchor}
              now={now}
              items={itemsByDay.get(ymd(anchor)) ?? []}
              events={eventsByDay.get(ymd(anchor)) ?? []}
              planDay={planByDay.get(ymd(anchor))}
              atRiskCount={data.atRisk.length}
              todayYmd={todayYmd}
              timeZone={zone}
              onSelect={setSelected}
            />
          )}
          {view === "week" && (
            <WeekView
              anchor={anchor}
              now={now}
              itemsByDay={itemsByDay}
              eventsByDay={eventsByDay}
              onSelect={setSelected}
              onPeek={setPeek}
            />
          )}
          {view === "month" && (
            <MonthView anchor={anchor} now={now} itemsByDay={itemsByDay} eventsByDay={eventsByDay} onPeek={setPeek} />
          )}

          {/* Folded-in extras: undated + completed */}
          {(undated.length > 0 || data.completed.length > 0) && (
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {undated.length > 0 && (
                <section>
                  <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
                    <Glyph d={ICON.inbox} size={14} /> No due date ({undated.length})
                  </h2>
                  <div className="mt-2 space-y-1.5">
                    {undated.map((it) => (
                      <ItemPill key={`und-${it.canvasId}`} item={it} onSelect={setSelected} timeZone={zone} showTime={false} />
                    ))}
                  </div>
                </section>
              )}
              {data.completed.length > 0 && (
                <section>
                  <button
                    type="button"
                    onClick={() => setShowCompleted((s) => !s)}
                    aria-expanded={showCompleted}
                    aria-controls="calendar-completed"
                    className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-success"
                  >
                    <Glyph d={ICON.check} size={14} /> Completed ({data.completed.length}) <span aria-hidden>{showCompleted ? "▾" : "▸"}</span>
                  </button>
                  {showCompleted && (
                    <div id="calendar-completed" className="mt-2 space-y-1.5">
                      {data.completed.map((it) => (
                        <ItemPill key={`done-${it.canvasId}`} item={it} onSelect={setSelected} timeZone={zone} showTime={false} />
                      ))}
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
        </div>
      )}

      {peek && (
        <DayPeek
          date={peek}
          items={itemsByDay.get(ymd(peek)) ?? []}
          events={eventsByDay.get(ymd(peek)) ?? []}
          study={(planByDay.get(ymd(peek))?.blocks ?? [])
            .filter((b) => isStudySessionBlock(b, todayYmd, zone))
            .map((b) => ({ canvasId: b.canvasId, name: b.name, courseName: b.courseName, hours: b.hours, dueAt: b.dueAt }))}
          onSelect={(it) => {
            // Phones: the day peek and the item detail are both bottom sheets —
            // swap one for the other instead of stacking them. Desktop keeps the
            // peek open beneath the detail dialog, as before.
            if (phone) setPeek(null);
            setSelected(it);
          }}
          onClose={() => setPeek(null)}
          onOpenDay={() => openDay(peek)}
          todayYmd={todayYmd}
          timeZone={zone}
        />
      )}
      {selected && <ItemDetail item={selected} onClose={() => setSelected(null)} todayYmd={todayYmd} timeZone={zone} />}
    </div>
  );
}

function DayView({
  date,
  now,
  items,
  events,
  planDay,
  atRiskCount,
  todayYmd,
  timeZone,
  onSelect,
}: {
  date: Date;
  now: Date;
  items: CalendarItem[];
  events: CalendarEvent[];
  planDay?: PlanDay;
  atRiskCount: number;
  todayYmd: string;
  timeZone: string;
  onSelect: (it: CalendarItem) => void;
}) {
  // Interleave coursework (by due time) and busy events (by start time).
  const rows = [
    ...items.map((it) => ({ t: it.dueAt ? new Date(it.dueAt).getTime() : 0, el: <ItemPill key={`i-${it.canvasId}`} item={it} onSelect={onSelect} timeZone={timeZone} /> })),
    ...events.map((ev, i) => ({ t: new Date(ev.startTime).getTime(), el: <BusyRow key={`e-${i}`} ev={ev} timeZone={timeZone} /> })),
  ].sort((a, b) => a.t - b.t);
  const quizzes = items.filter((it) => it.type === "quiz" || it.type === "exam").length;
  // Real study sessions only (lib/studyWeek — THE rule). A zero-hour "due this
  // day" marker is the item itself, already listed on the left — never "Study: … · 0m".
  const study = (planDay?.blocks ?? []).filter((b) => isStudySessionBlock(b, todayYmd, timeZone));

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_19rem]">
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-ink">
            {sameDay(date, now) && <span className="text-accent">Today · </span>}
            {fullDate(date)}
          </p>
        </div>
        <div className="mt-4 space-y-1.5">
          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">Nothing due — nice.</p>
          ) : (
            rows.map((r) => r.el)
          )}
        </div>
      </div>
      <aside className="space-y-4">
        <div className="card p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">At a glance</h2>
          <dl className="mt-2 space-y-1 text-sm">
            <Glance k="Due this day" v={items.length} />
            <Glance k="Quizzes / exams" v={quizzes} />
            <Glance k="Past due" v={atRiskCount} pastDue={atRiskCount > 0} />
          </dl>
        </div>
        {study.length > 0 && (
          <div className="card p-4">
            <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
              <Glyph d={ICON.clock} size={14} /> Study sessions
            </h2>
            <ul className="mt-2 space-y-1.5 text-sm">
              {study.map((b, i) => (
                <li key={`st-${b.canvasId}-${i}`} className="flex items-center gap-2">
                  <span className="h-3.5 w-1 shrink-0 rounded-full" style={{ background: courseColor(b.courseName) }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-ink">Study: {b.name}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {fmtHours(b.hours)} · <DueLabel iso={b.dueAt} format="chip" todayYmd={todayYmd} timeZone={timeZone} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}
function Glance({ k, v, pastDue }: { k: string; v: number; pastDue?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted">{k}</dt>
      <dd className={`font-semibold ${pastDue ? "text-warning" : "text-ink"}`}>{v}</dd>
    </div>
  );
}

function WeekView({
  anchor,
  now,
  itemsByDay,
  eventsByDay,
  onSelect,
  onPeek,
}: {
  anchor: Date;
  now: Date;
  itemsByDay: Map<string, CalendarItem[]>;
  eventsByDay: Map<string, CalendarEvent[]>;
  onSelect: (it: CalendarItem) => void;
  onPeek: (d: Date) => void;
}) {
  // Rolling: the anchor day (today, from the "Today" button) and the six after it.
  const { start, days: n } = rangeForView("week", anchor);
  const days = Array.from({ length: n }, (_, i) => addDays(start, i));
  const MAX = 6;
  // Tag the first populated day so the demo tour can spotlight a real, compact
  // target (highlighting the whole week grid reads as "off").
  const firstWithItems = days.findIndex((d) => (itemsByDay.get(ymd(d))?.length ?? 0) > 0);
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-7">
      {days.map((d, i) => {
        const key = ymd(d);
        const items = itemsByDay.get(key) ?? [];
        const events = eventsByDay.get(key) ?? [];
        const isToday = sameDay(d, now);
        const isPast = d < now;
        const shown = items.slice(0, MAX);
        const more = items.length - shown.length;
        return (
          <div
            key={key}
            data-tour={i === firstWithItems ? "cal-day" : undefined}
            className={`card flex min-h-[7rem] flex-col p-3 ${isToday ? "ring-2 ring-accent bg-accent-soft/40" : ""} ${isPast ? "opacity-70" : ""}`}
          >
            <button onClick={() => onPeek(d)} className="flex items-baseline justify-between rounded hover:bg-surface-soft" title="Open this day">
              <span className={`text-sm font-semibold ${isToday ? "text-accent" : "text-ink"}`}>
                {WEEKDAYS[d.getDay()]} {d.getDate()}
              </span>
              {isToday && <span className="text-xs font-semibold text-accent">Today</span>}
            </button>
            <div className="mt-2 space-y-1.5">
              {shown.map((it) => (
                <WeekChip key={`w-${it.canvasId}`} item={it} onSelect={onSelect} />
              ))}
              {more > 0 && (
                <button onClick={() => onPeek(d)} className="w-full rounded-md px-2 py-1 text-left text-xs font-medium text-accent hover:bg-accent-soft">
                  +{more} more
                </button>
              )}
              {events.length > 0 && (
                <button
                  onClick={() => onPeek(d)}
                  className="flex w-full items-center gap-1.5 rounded-md border border-dashed border-line px-2 py-1 text-left text-xs text-faint"
                >
                  <Glyph d={ICON.calendar} size={12} /> {events.length} busy
                </button>
              )}
              {items.length === 0 && events.length === 0 && (
                <button type="button" onClick={() => onPeek(d)} aria-label={`Nothing due ${fullDate(d)}. Open this day`} className="px-1 py-3 text-left text-xs text-faint hover:text-muted">
                  <span aria-hidden>—</span>
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A coursework chip sized for a narrow week column: the course colour rail and
 *  the title on up to two lines — never "TO…" (#141). Past due is never colour
 *  alone: the calm warning border comes with the alert glyph (as ItemPill's), and
 *  the accessible name says "past due" and carries the readable course name. */
function WeekChip({ item, onSelect }: { item: CalendarItem; onSelect: (it: CalendarItem) => void }) {
  const overdue = item.status === "overdue";
  const done = item.status === "done";
  const course = shortCourse(item.courseName);
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      title={`${course} · ${item.name}${overdue ? " · Past due" : ""}`}
      aria-label={`${item.name}, ${course}${overdue ? ", past due" : done ? ", done" : ""}`}
      className={`flex w-full items-stretch gap-2 rounded-lg border bg-surface px-2 py-1.5 text-left transition hover:shadow-sm ${overdue ? "border-warning/50" : "border-line-subtle"} ${done ? "opacity-60" : ""}`}
    >
      <span className="w-1.5 shrink-0 rounded-full" style={{ background: courseColor(item.courseName) }} aria-hidden />
      {overdue && (
        <span className="mt-px shrink-0 text-warning" aria-hidden>
          <Glyph d={ICON.alert} size={13} />
        </span>
      )}
      <span className={`line-clamp-2 min-w-0 flex-1 break-words text-[13px] leading-snug ${done ? "text-muted line-through" : "text-ink"}`}>{item.name}</span>
    </button>
  );
}

function MonthView({
  anchor,
  now,
  itemsByDay,
  eventsByDay,
  onPeek,
}: {
  anchor: Date;
  now: Date;
  itemsByDay: Map<string, CalendarItem[]>;
  eventsByDay: Map<string, CalendarEvent[]>;
  onPeek: (d: Date) => void;
}) {
  const cells = monthGrid(anchor);
  const month = anchor.getMonth();
  return (
    <div>
      {/* Phones (#39) never get Month from the Plan tabs, but a demo/deep link can
          land here: below md the 7-column grid scrolls sideways inside its own box
          (560px floor) instead of crushing the cells or widening the page. md+ is
          unchanged. */}
      <div className="overflow-x-auto md:overflow-visible">
        <div className="min-w-[560px] md:min-w-0">
          <div className="mb-1.5 grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted">
            {WEEKDAYS_MON_FIRST.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((d) => {
              const key = ymd(d);
              const items = itemsByDay.get(key) ?? [];
              const hasBusy = (eventsByDay.get(key) ?? []).length > 0;
              const inMonth = d.getMonth() === month;
              const isToday = sameDay(d, now);
              const atRisk = items.filter((it) => it.status === "overdue").length;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onPeek(d)}
                  aria-label={[
                    fullDate(d) + (isToday ? ", today" : ""),
                    items.length > 0 ? `${items.length} due` : "nothing due",
                    atRisk > 0 ? `${atRisk} past due` : "",
                    hasBusy ? "busy" : "",
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  className={`flex min-h-[5.5rem] flex-col rounded-md border p-1.5 text-left transition hover:border-accent ${
                    inMonth ? "border-line-subtle bg-surface" : "border-transparent bg-surface-soft"
                  }`}
                >
                  <span className="flex items-center justify-between">
                    <span className={`text-xs font-medium ${atRisk ? "text-warning" : isToday ? "text-accent" : inMonth ? "text-ink" : "text-faint"} ${isToday ? "flex h-5 w-5 items-center justify-center rounded-full bg-accent-soft" : ""}`}>
                      {d.getDate()}
                    </span>
                    {hasBusy && <span className="text-faint" aria-label="busy"><Glyph d={ICON.calendar} size={10} /></span>}
                  </span>
                  {items.length === 0 ? null : items.length <= 3 ? (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {items.map((it) => (
                        <span
                          key={it.canvasId}
                          className="h-2 w-2 rounded-full"
                          style={{ background: it.status === "overdue" ? "rgb(var(--warning))" : courseColor(it.courseName) }}
                          title={it.name}
                        />
                      ))}
                    </span>
                  ) : (
                    <span className="mt-1 space-y-0.5">
                      <span className="block truncate text-xs text-ink">{items[0].name}</span>
                      <span className="flex items-center gap-1 text-xs text-muted">
                        +{items.length - 1} {atRisk > 0 && <span className="font-semibold text-warning">⚠{atRisk}</span>}
                      </span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <MonthLegend />
    </div>
  );
}

function MonthLegend() {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-line-subtle bg-surface-soft px-3 py-2 text-xs text-muted">
      <span className="text-xs font-semibold uppercase tracking-wide text-ink">Key</span>
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-accent" aria-hidden /> a course (each has its own color)
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-warning" aria-hidden /> past due
      </span>
      <span className="flex items-center gap-1.5">
        <span className="font-semibold text-warning">⚠</span> past-due count
      </span>
      <span className="flex items-center gap-1.5">
        <Glyph d={ICON.calendar} size={12} /> busy day
      </span>
    </div>
  );
}
