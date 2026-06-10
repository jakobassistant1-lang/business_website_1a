"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  startOfDay,
  addDays,
  ymd,
  parseYmd,
  sameDay,
  weekStart,
  monthGrid,
  rangeForView,
  rangeLabel,
  WEEKDAYS,
} from "@/lib/calendarDates";
import {
  AttentionBanner,
  RecommendedOrder,
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
  LoadHint,
} from "@/components/calendar/parts";
import { toneSoft } from "@/lib/tone";
import { courseColor } from "@/lib/courseColor";
import type { CalendarData, CalendarItem } from "@/lib/calendarData";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { PlanDay } from "@/lib/scheduler";

type View = "day" | "week" | "month";

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

export function CalendarView({ data, todayYmd }: { data: CalendarData; todayYmd: string }) {
  const router = useRouter();
  // "Today" comes from the server (todayYmd) so the SSR'd HTML and the client's
  // first render agree — no hydration mismatch — and it's consistent with the
  // app's server-time day handling.
  const [now] = useState(() => parseYmd(todayYmd));
  const [view, setView] = useState<View>("day");
  const [anchor, setAnchor] = useState(() => parseYmd(todayYmd));
  const [selected, setSelected] = useState<CalendarItem | null>(null);
  const [peek, setPeek] = useState<Date | null>(null);
  const [showCompleted, setShowCompleted] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const didAutoSync = useRef(false);

  const itemsByDay = useMemo(() => {
    const m = group(data.items, (it) => (it.dueAt ? ymd(new Date(it.dueAt)) : null));
    for (const arr of m.values()) arr.sort((a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime());
    return m;
  }, [data.items]);
  const eventsByDay = useMemo(() => group(data.events, (ev) => ymd(new Date(ev.startTime))), [data.events]);
  const planByDay = useMemo(() => {
    const m = new Map<string, PlanDay>();
    for (const d of data.plan.days) m.set(d.date, d);
    return m;
  }, [data.plan.days]);
  const undated = useMemo(() => data.items.filter((it) => !it.dueAt), [data.items]);

  // Auto-sync once per browser session (≈ on login), same as the old Plan page.
  useEffect(() => {
    if (!data.connected || didAutoSync.current) return;
    didAutoSync.current = true;
    if (typeof window !== "undefined" && sessionStorage.getItem("sp_autosynced")) return;
    if (typeof window !== "undefined") sessionStorage.setItem("sp_autosynced", "1");
    void runSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runSync() {
    setSyncing(true);
    await fetch("/api/sync", { method: "POST" }).catch(() => {});
    await fetch("/api/analyze", { method: "POST" }).catch(() => {});
    setSyncing(false);
    router.refresh();
  }

  function navigate(dir: -1 | 1) {
    if (view === "day") setAnchor((a) => addDays(a, dir));
    else if (view === "week") setAnchor((a) => addDays(a, dir * 7));
    else setAnchor((a) => new Date(a.getFullYear(), a.getMonth() + dir, 1));
  }
  function openDay(d: Date) {
    setAnchor(startOfDay(d));
    setView("day");
  }

  const atToday =
    view === "day"
      ? sameDay(anchor, now)
      : view === "week"
        ? sameDay(weekStart(anchor), weekStart(now))
        : anchor.getMonth() === now.getMonth() && anchor.getFullYear() === now.getFullYear();
  const { start, days } = rangeForView(view, anchor);

  const statusPill = !data.connected
    ? { text: "Not connected", cls: toneSoft.neutral }
    : data.syncedAt === null
      ? { text: "Not synced yet", cls: toneSoft.neutral }
      : data.stale
        ? { text: "Stale data", cls: toneSoft.neutral }
        : { text: "Up to date", cls: toneSoft.success };

  return (
    <div>
      {/* Header — compact single row so the calendar sits high on the page */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h1 className="text-xl font-semibold tracking-tight">Calendar</h1>
          <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${statusPill.cls}`}>{statusPill.text}</span>
        </div>
        {data.connected && (
          <button onClick={runSync} className="btn-ghost text-sm" disabled={syncing}>
            {syncing ? "Syncing…" : "Sync"}
          </button>
        )}
      </div>

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
            onView={(v) => setView(v as View)}
            label={rangeLabel(view, anchor, now)}
            onPrev={() => navigate(-1)}
            onNext={() => navigate(1)}
            onToday={() => setAnchor(now)}
            atToday={atToday}
            trailing={view === "week" && atToday ? <LoadHint overloadHours={data.overloadHours} weekKey={todayYmd} /> : undefined}
          />
          <PeriodSummary view={view} start={ymd(start)} days={days} />

          {view === "day" && (
            <DayView
              date={anchor}
              now={now}
              items={itemsByDay.get(ymd(anchor)) ?? []}
              events={eventsByDay.get(ymd(anchor)) ?? []}
              planDay={planByDay.get(ymd(anchor))}
              recommendations={data.recommendations}
              atRiskCount={data.atRisk.length}
              onSelect={setSelected}
            />
          )}
          {view === "week" && (
            <WeekView
              anchor={anchor}
              now={now}
              itemsByDay={itemsByDay}
              eventsByDay={eventsByDay}
              planByDay={planByDay}
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
                      <ItemPill key={`und-${it.canvasId}`} item={it} onSelect={setSelected} showTime={false} />
                    ))}
                  </div>
                </section>
              )}
              {data.completed.length > 0 && (
                <section>
                  <button
                    onClick={() => setShowCompleted((s) => !s)}
                    className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-success"
                  >
                    <Glyph d={ICON.check} size={14} /> Completed ({data.completed.length}) {showCompleted ? "▾" : "▸"}
                  </button>
                  {showCompleted && (
                    <div className="mt-2 space-y-1.5">
                      {data.completed.map((it) => (
                        <ItemPill key={`done-${it.canvasId}`} item={it} onSelect={setSelected} showTime={false} />
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
            .filter((b) => b.study)
            .map((b) => ({ canvasId: b.canvasId, name: b.name, courseName: b.courseName, hours: b.hours, dueAt: b.dueAt }))}
          onSelect={setSelected}
          onClose={() => setPeek(null)}
          onOpenDay={() => openDay(peek)}
        />
      )}
      {selected && <ItemDetail item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function LoadMeter({ planDay }: { planDay?: PlanDay }) {
  if (!planDay) return null;
  const pct = planDay.capacity > 0 ? Math.min(100, (planDay.allocated / planDay.capacity) * 100) : 0;
  const over = planDay.allocated > planDay.capacity + 1e-9;
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          {planDay.allocated}/{planDay.capacity}h planned
        </span>
        {over && <span className="text-danger">over capacity</span>}
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-soft">
        <div className={`h-full rounded-full ${over ? "bg-danger" : "bg-accent"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function DayView({
  date,
  now,
  items,
  events,
  planDay,
  recommendations,
  atRiskCount,
  onSelect,
}: {
  date: Date;
  now: Date;
  items: CalendarItem[];
  events: CalendarEvent[];
  planDay?: PlanDay;
  recommendations: CalendarData["recommendations"];
  atRiskCount: number;
  onSelect: (it: CalendarItem) => void;
}) {
  // Interleave coursework (by due time) and busy events (by start time).
  const rows = [
    ...items.map((it) => ({ t: it.dueAt ? new Date(it.dueAt).getTime() : 0, el: <ItemPill key={`i-${it.canvasId}`} item={it} onSelect={onSelect} /> })),
    ...events.map((ev, i) => ({ t: new Date(ev.startTime).getTime(), el: <BusyRow key={`e-${i}`} ev={ev} /> })),
  ].sort((a, b) => a.t - b.t);
  const quizzes = items.filter((it) => it.type === "quiz" || it.type === "exam").length;
  const study = (planDay?.blocks ?? []).filter((b) => b.study);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_19rem]">
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-ink">
            {sameDay(date, now) ? "Today" : ""} {date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </p>
        </div>
        <LoadMeter planDay={planDay} />
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
            <Glance k="Overdue" v={atRiskCount} danger={atRiskCount > 0} />
          </dl>
        </div>
        {study.length > 0 && (
          <div className="card p-4">
            <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
              <Glyph d={ICON.clock} size={14} /> Study plan
            </h2>
            <ul className="mt-2 space-y-1.5 text-sm">
              {study.map((b, i) => (
                <li key={`st-${b.canvasId}-${i}`} className="flex items-center gap-2">
                  <span className="h-3.5 w-1 shrink-0 rounded-full" style={{ background: courseColor(b.courseName) }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-ink">Study: {b.name}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {fmtHours(b.hours)} · due {new Date(b.dueAt).toLocaleDateString(undefined, { weekday: "short" })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <RecommendedOrder recs={recommendations} />
      </aside>
    </div>
  );
}
function Glance({ k, v, danger }: { k: string; v: number; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted">{k}</dt>
      <dd className={`font-semibold ${danger ? "text-danger" : "text-ink"}`}>{v}</dd>
    </div>
  );
}

function WeekView({
  anchor,
  now,
  itemsByDay,
  eventsByDay,
  planByDay,
  onSelect,
  onPeek,
}: {
  anchor: Date;
  now: Date;
  itemsByDay: Map<string, CalendarItem[]>;
  eventsByDay: Map<string, CalendarEvent[]>;
  planByDay: Map<string, PlanDay>;
  onSelect: (it: CalendarItem) => void;
  onPeek: (d: Date) => void;
}) {
  const start = weekStart(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const MAX = 4;
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-7">
      {days.map((d) => {
        const key = ymd(d);
        const items = itemsByDay.get(key) ?? [];
        const events = eventsByDay.get(key) ?? [];
        const plan = planByDay.get(key);
        const isToday = sameDay(d, now);
        const isPast = d < now;
        const shown = items.slice(0, MAX);
        const more = items.length - shown.length;
        return (
          <div
            key={key}
            className={`card flex flex-col p-2 ${isToday ? "ring-2 ring-accent-ring bg-accent-soft/30" : ""} ${isPast ? "opacity-70" : ""}`}
          >
            <button onClick={() => onPeek(d)} className="flex items-baseline justify-between rounded hover:bg-surface-soft" title="Open this day">
              <span className="text-xs font-semibold text-ink">
                {WEEKDAYS[d.getDay()]} {d.getDate()}
              </span>
              {isToday && <span className="text-[10px] font-semibold text-accent">TODAY</span>}
            </button>
            {plan && (
              <span className={`mt-0.5 text-[10px] ${plan.allocated > plan.capacity + 1e-9 ? "text-danger" : "text-muted"}`}>
                {plan.allocated}/{plan.capacity}h
              </span>
            )}
            <div className="mt-1.5 space-y-1">
              {shown.map((it) => (
                <ItemPill key={`w-${it.canvasId}`} item={it} onSelect={onSelect} showTime={false} />
              ))}
              {more > 0 && (
                <button onClick={() => onPeek(d)} className="w-full rounded-md px-1.5 py-0.5 text-left text-[11px] text-muted hover:bg-surface-soft">
                  +{more} more
                </button>
              )}
              {events.length > 0 && (
                <button
                  onClick={() => onPeek(d)}
                  className="flex w-full items-center gap-1 rounded-md border border-dashed border-line px-1.5 py-0.5 text-left text-[10px] text-faint"
                >
                  <Glyph d={ICON.calendar} size={10} /> {events.length} busy
                </button>
              )}
              {items.length === 0 && events.length === 0 && (
                <button onClick={() => onPeek(d)} className="px-1 py-2 text-left text-[11px] text-faint hover:text-muted">
                  —
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
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
      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => (
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
              onClick={() => onPeek(d)}
              className={`flex min-h-[4.5rem] flex-col rounded-md border p-1 text-left transition hover:border-accent ${
                inMonth ? "border-line-subtle bg-surface" : "border-transparent bg-surface-soft"
              }`}
            >
              <span className="flex items-center justify-between">
                <span className={`text-xs font-medium ${atRisk ? "text-danger" : isToday ? "text-accent" : inMonth ? "text-ink" : "text-faint"} ${isToday ? "flex h-5 w-5 items-center justify-center rounded-full bg-accent-soft" : ""}`}>
                  {d.getDate()}
                </span>
                {hasBusy && <span className="text-faint" aria-label="busy"><Glyph d={ICON.calendar} size={10} /></span>}
              </span>
              {items.length === 0 ? null : items.length <= 3 ? (
                <span className="mt-1 flex flex-wrap gap-1">
                  {items.map((it) => (
                    <span
                      key={it.canvasId}
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: it.status === "overdue" ? "rgb(var(--danger))" : courseColor(it.courseName) }}
                      title={it.name}
                    />
                  ))}
                </span>
              ) : (
                <span className="mt-1 space-y-0.5">
                  <span className="block truncate text-[10px] text-ink">{items[0].name}</span>
                  <span className="flex items-center gap-1 text-[10px] text-muted">
                    +{items.length - 1} {atRisk > 0 && <span className="font-semibold text-danger">⚠{atRisk}</span>}
                  </span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
