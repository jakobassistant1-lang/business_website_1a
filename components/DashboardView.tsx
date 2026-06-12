"use client";

// The Dashboard — a single-focus "command screen". A solid-violet Focus module
// (the #1 upcoming task), a priority-ranked Today list whose rows complete
// themselves the moment Canvas reports a submission (flash accent → settle grey),
// a daily-progress ring, and a context rail (This week / Overdue / jump links).
// Overdue work lives only in the rail; Focus + Next-up are forward-looking, so
// the three zones never contradict each other.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ymd, parseYmd, WEEKDAYS, WEEKDAYS_FULL, MONTHS_SHORT, MONTHS_LONG } from "@/lib/calendarDates";
import { round1 } from "@/lib/round";
import { toneSoft } from "@/lib/tone";
import { ItemDetail, Glyph, ICON, fmtHours, fmtTime } from "@/components/calendar/parts";
import type { CalendarData, CalendarItem } from "@/lib/calendarData";
import type { ItemType } from "@/lib/itemType";

const TODAY_MAX = 7;
const TYPE_LABEL: Record<ItemType, string> = { assignment: "Assignment", quiz: "Quiz", exam: "Exam", other: "Task" };
const shortCourse = (name: string) => name.split(" · ")[0];
// Locale-independent date strings (avoid a server/client locale hydration mismatch).
const fmtLongDate = (d: Date) => `${WEEKDAYS_FULL[d.getDay()]}, ${MONTHS_LONG[d.getMonth()]} ${d.getDate()}`;
const fmtShortDate = (d: Date) => `${WEEKDAYS[d.getDay()]}, ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;

export function DashboardView({ data, todayYmd: serverToday, firstName }: { data: CalendarData; todayYmd: string; firstName: string }) {
  const router = useRouter();
  const [greeting, setGreeting] = useState("Hello"); // neutral on first render → no hydration mismatch
  const [todayYmd, setTodayYmd] = useState(serverToday);
  const [selected, setSelected] = useState<CalendarItem | null>(null);
  const [newlyDone, setNewlyDone] = useState<Set<number>>(new Set());
  const didAutoSync = useRef(false);

  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
    // "Today" is the USER's local day, not the server's (which is UTC on Vercel),
    // so day-membership matches how the items below are bucketed. (#3)
    const t = ymd(new Date());
    if (t !== serverToday) setTodayYmd(t);
  }, [serverToday]);

  // Sync Canvas once per browser session (shared key with the Calendar). A fresh
  // sync is what turns a just-submitted assignment "done" on the dashboard.
  useEffect(() => {
    if (!data.connected || didAutoSync.current) return;
    didAutoSync.current = true;
    if (typeof window !== "undefined" && sessionStorage.getItem("sp_autosynced")) return;
    if (typeof window !== "undefined") sessionStorage.setItem("sp_autosynced", "1");
    (async () => {
      await fetch("/api/sync", { method: "POST" }).catch(() => {});
      await fetch("/api/analyze", { method: "POST" }).catch(() => {});
      router.refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Today's work, ranked by importance (not clock time) ---------------
  // `ranked` is the FULL importance order, so every Today row sorts correctly
  // (recommendations alone is just the top few). (#1)
  const rank = new Map(data.ranked.map((r, i) => [r.canvasId, i]));
  const isDueToday = (it: CalendarItem) => it.dueAt != null && ymd(new Date(it.dueAt)) === todayYmd;

  const todayActive = data.items
    .filter((it) => it.status !== "done" && isDueToday(it))
    .sort((a, b) => {
      const ra = rank.get(a.canvasId) ?? 1e9;
      const rb = rank.get(b.canvasId) ?? 1e9;
      if (ra !== rb) return ra - rb;
      return (a.dueAt ? +new Date(a.dueAt) : 0) - (b.dueAt ? +new Date(b.dueAt) : 0);
    });
  const todayDone = data.completed.filter(isDueToday);
  const leadId = todayActive[0]?.canvasId ?? null;

  // Study blocks only make sense for assessments still AHEAD — never surface
  // "study for X" once X is due today (or already taken), and never a 0h block.
  const todayBlocks = data.plan.days.find((d) => d.date === todayYmd)?.blocks ?? [];
  const studyFuture = todayBlocks.filter((b) => b.study && b.hours > 0 && ymd(new Date(b.dueAt)) > todayYmd);

  // Newly-submitted-today rows flash the accent once, then settle grey. State is
  // day-scoped + bounded; the first load of a day seeds silently so already-done
  // work doesn't all flash at once. (#4)
  const doneKey = todayDone
    .map((i) => i.canvasId)
    .sort((a, b) => a - b)
    .join(",");
  useEffect(() => {
    const ids = doneKey ? doneKey.split(",").map(Number) : [];
    let stored: { day?: string; ids?: number[] } = {};
    try {
      const parsed = JSON.parse(localStorage.getItem("sp_seen_done") || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed;
    } catch {
      /* ignore */
    }
    const sameDay = stored.day === todayYmd && Array.isArray(stored.ids);
    const seen = new Set<number>(sameDay ? (stored.ids as number[]) : []);
    const fresh = sameDay ? ids.filter((id) => !seen.has(id)) : [];
    if (fresh.length) setNewlyDone((prev) => new Set([...prev, ...fresh]));
    try {
      localStorage.setItem("sp_seen_done", JSON.stringify({ day: todayYmd, ids }));
    } catch {
      /* ignore */
    }
  }, [doneKey, todayYmd]);

  const today = parseYmd(todayYmd);
  const dialTotal = todayActive.length + todayDone.length;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-7 flex items-center justify-between gap-4">
        <div>
          <p className="text-xl font-semibold text-ink">
            {greeting}
            {firstName ? `, ${firstName}` : ""}
          </p>
          <p className="mt-0.5 text-sm text-muted">{fmtLongDate(today)}</p>
        </div>
        {data.connected && <ProgressRing done={todayDone.length} total={dialTotal} />}
      </div>

      {!data.connected ? (
        <ConnectCard />
      ) : (
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="min-w-0 flex-1 space-y-6">
            <FocusModule data={data} todayYmd={todayYmd} onSelect={setSelected} />
            <TodayCard
              today={today}
              active={todayActive}
              doneItems={todayDone}
              study={studyFuture}
              leadId={leadId}
              newlyDone={newlyDone}
              busyCount={data.events.filter((e) => ymd(new Date(e.startTime)) === todayYmd).length}
              onSelect={setSelected}
            />
          </div>
          <aside className="w-full shrink-0 space-y-6 lg:w-96">
            <WeekCard data={data} />
            <OverdueCard atRisk={data.atRisk} />
            <div className="space-y-2 px-1">
              <Link href="/timeline" className="block text-[15px] font-medium text-accent hover:underline">
                Jump to timeline →
              </Link>
              <Link href="/calendar" className="block text-[15px] font-medium text-accent hover:underline">
                Open calendar →
              </Link>
            </div>
          </aside>
        </div>
      )}

      {selected && <ItemDetail item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

// ── Daily-progress ring: ONE smooth continuous ring whose filled arc deepens
// through 4 discrete violet shades as the day's submissions roll in — the shades
// read in COLOR only, not as separated segments. Big % in the middle. ──────────
function ringPoint(cx: number, cy: number, r: number, f: number): [number, number] {
  const a = (-90 + f * 360) * (Math.PI / 180);
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
function ringArc(cx: number, cy: number, r: number, f0: number, f1: number): string {
  const [x0, y0] = ringPoint(cx, cy, r, f0);
  const [x1, y1] = ringPoint(cx, cy, r, f1);
  const large = f1 - f0 > 0.5 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
function ProgressRing({ done, total }: { done: number; total: number }) {
  const ratio = total > 0 ? Math.min(1, done / total) : 0;
  const pct = Math.round(ratio * 100);
  const shades = ["rgb(var(--accent) / 0.40)", "rgb(var(--accent) / 0.62)", "rgb(var(--accent) / 0.82)", "rgb(var(--accent) / 1)"];
  const cx = 60;
  const cy = 60;
  const r = 52;
  const sw = 13;
  return (
    <div className="relative h-32 w-32 shrink-0 sm:h-36 sm:w-36">
      <svg viewBox="0 0 120 120" className="h-full w-full" role="img" aria-label={total > 0 ? `${pct}% of today's work done` : "Nothing due today"}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgb(var(--accent) / 0.12)" strokeWidth={sw} />
        {[0, 1, 2, 3].map((i) => {
          const start = i / 4;
          if (ratio <= start) return null;
          const end = Math.min((i + 1) / 4, ratio);
          // darker bands draw last and overlap a hair backward so joins are seamless
          return <path key={i} d={ringArc(cx, cy, r, i === 0 ? 0 : start - 0.006, end)} fill="none" stroke={shades[i]} strokeWidth={sw} strokeLinecap="butt" />;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[2.5rem] font-bold leading-none tracking-tight text-ink sm:text-[2.85rem]">{total > 0 ? `${pct}%` : "—"}</span>
        <span className="mt-1.5 text-xs font-medium text-muted">{total > 0 ? `${done} of ${total} done` : "Nothing due"}</span>
      </div>
    </div>
  );
}

// A reason-chip on the violet Focus card (white-on-accent is the only variant).
function Chip({ text }: { text: string }) {
  return <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium text-white ring-1 ring-inset ring-white/25">{text}</span>;
}

function focusChips(item: CalendarItem, isToday: boolean): string[] {
  const out: string[] = [];
  if (item.dueAt) out.push(isToday ? `Due ${fmtTime(item.dueAt)}` : `Due ${WEEKDAYS[new Date(item.dueAt).getDay()]}`);
  if (item.pointsPossible != null && item.pointsPossible > 0) out.push(`${item.pointsPossible} pts`);
  return out;
}

function focusRationale(item: CalendarItem, isToday: boolean): string {
  const parts: string[] = [];
  if (item.pointsPossible != null && item.pointsPossible > 0) parts.push(`Worth ${item.pointsPossible} pts`);
  if (isToday) parts.push("due today");
  const lead = parts.length ? parts.join(" and ") : item.name;
  return lead + (isToday ? " — knock it out today." : " — a strong place to start.");
}

function FocusModule({ data, todayYmd, onSelect }: { data: CalendarData; todayYmd: string; onSelect: (it: CalendarItem) => void }) {
  // `recommendations` is already forward-looking (overdue excluded upstream), so
  // the top entry is the thing to do next — never an overdue item. (#1, #10)
  const top = data.recommendations[0];
  const topItem = top ? data.items.find((it) => it.canvasId === top.canvasId) : undefined;
  const nextRecs = data.recommendations.slice(1, 3);
  const isToday = !!topItem?.dueAt && ymd(new Date(topItem.dueAt)) === todayYmd;

  if (!top) {
    const caughtUp = data.atRisk.length === 0;
    return (
      <div className="card p-8 text-center">
        <div className="flex justify-center text-success">
          <Glyph d={ICON.check} size={34} />
        </div>
        <p className="mt-3 text-xl font-semibold text-ink">{caughtUp ? "You're all caught up." : "Nothing new queued up."}</p>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">
          {caughtUp
            ? "Nothing's due and nothing's overdue. Enjoy the breathing room — we'll nudge you when something lands."
            : "Your upcoming work is clear; the overdue items in the rail are the thing to chip away at when you're ready."}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-accent p-7 text-white shadow-card">
      <div className="flex gap-6">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-white/80">Focus now</p>
          <button onClick={() => topItem && onSelect(topItem)} className="mt-1.5 block max-w-full text-left" disabled={!topItem}>
            <span className="block text-[2rem] font-bold leading-[1.1] tracking-tight">{top.name}</span>
          </button>
          <div className="mt-3 flex flex-wrap gap-2">
            {(topItem ? focusChips(topItem, isToday) : []).map((c, i) => (
              <Chip key={i} text={c} />
            ))}
          </div>
          <p className="mt-3 text-[15px] text-white/90">{topItem ? focusRationale(topItem, isToday) : top.reason}</p>
          <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
            {topItem ? (
              <button onClick={() => onSelect(topItem)} className="rounded-[14px] bg-white px-5 py-2.5 text-sm font-semibold text-accent transition hover:bg-white/90">
                Open
              </button>
            ) : top.htmlUrl ? (
              <a href={top.htmlUrl} target="_blank" rel="noreferrer" className="rounded-[14px] bg-white px-5 py-2.5 text-sm font-semibold text-accent transition hover:bg-white/90">
                Open ↗
              </a>
            ) : null}
            <Link href="/timeline" className="rounded-[14px] border border-white/40 px-5 py-2.5 text-center text-sm font-medium text-white transition hover:bg-white/10">
              See my plan ›
            </Link>
          </div>
        </div>
        {nextRecs.length > 0 && (
          <div className="hidden w-48 shrink-0 border-l border-white/20 pl-5 sm:block">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/70">Next up</p>
            <div className="mt-3 space-y-3.5">
              {nextRecs.map((r) => {
                const it = data.items.find((x) => x.canvasId === r.canvasId);
                return (
                  <div key={r.canvasId} className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{r.name}</p>
                    <p className="truncate text-[13px] text-white/70">
                      {it ? `${TYPE_LABEL[it.type]} · ` : ""}
                      {shortCourse(r.courseName)}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// One status disc per row. It mirrors Canvas — empty until submitted, then a
// filled green check. It is NOT a manual toggle (completion comes from Canvas).
function StatusDisc({ kind }: { kind: "done" | "study" | "active" }) {
  if (kind === "done")
    return (
      <span role="img" aria-label="Completed" className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-success text-white">
        <Glyph d={ICON.check} size={13} />
      </span>
    );
  const ring = kind === "study" ? "border-success/70" : "border-line";
  return <span className={`h-[22px] w-[22px] shrink-0 rounded-full border-2 ${ring}`} aria-hidden />;
}

function ItemRow({ item, lead, done, glow, onSelect }: { item: CalendarItem; lead: boolean; done: boolean; glow: boolean; onSelect: (it: CalendarItem) => void }) {
  const timeColor = lead ? "text-accent" : "text-ink";
  return (
    <div className={`flex items-center gap-3.5 rounded-xl px-3 py-3.5 ${lead ? "border-l-[3px] border-accent bg-accent-soft/50" : ""} ${glow ? "animate-done-glow" : ""}`}>
      <StatusDisc kind={done ? "done" : "active"} />
      <button onClick={() => onSelect(item)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[15px] ${done ? "text-muted line-through" : "font-medium text-ink"} ${lead && !done ? "font-semibold" : ""}`}>{item.name}</span>
          <span className="block truncate text-[13px] text-muted">
            {TYPE_LABEL[item.type]} · {shortCourse(item.courseName)}
          </span>
        </span>
        {done ? (
          <span className="shrink-0 text-[12px] font-medium text-success">Done</span>
        ) : (
          <span className={`shrink-0 text-[13px] font-medium ${timeColor}`}>{item.dueAt ? fmtTime(item.dueAt) : ""}</span>
        )}
      </button>
      {!done && (item.type === "quiz" || item.type === "exam") && (
        <Link href={`/study?item=${item.canvasId}`} className="shrink-0 text-[12px] font-medium text-accent hover:underline">
          Study
        </Link>
      )}
    </div>
  );
}

function TodayCard({
  today,
  active,
  doneItems,
  study,
  leadId,
  newlyDone,
  busyCount,
  onSelect,
}: {
  today: Date;
  active: CalendarItem[];
  doneItems: CalendarItem[];
  study: { canvasId: number; name: string; hours: number }[];
  leadId: number | null;
  newlyDone: Set<number>;
  busyCount: number;
  onSelect: (it: CalendarItem) => void;
}) {
  const totalRows = active.length + study.length + doneItems.length;
  const empty = totalRows === 0;
  // Active (priority order) → future study → completed (struck), capped.
  const activeShown = active.slice(0, TODAY_MAX);
  let budget = TODAY_MAX - activeShown.length;
  const studyShown = study.slice(0, Math.max(0, budget));
  budget -= studyShown.length;
  const doneShown = doneItems.slice(0, Math.max(0, budget));
  const hidden = totalRows - activeShown.length - studyShown.length - doneShown.length;
  // Only an overflow of coursework means "Today" is truncated; busy events are
  // extra context shown alongside, never the sole reason for the link. (#7)
  const overflowText = hidden > 0 ? `${hidden} more${busyCount > 0 ? ` · ${busyCount} busy` : ""}` : "";

  return (
    <div className="card p-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-ink">Today</h2>
        <span className="text-sm text-muted">{fmtShortDate(today)}</span>
      </div>
      {empty ? (
        <p className="py-10 text-center text-sm text-muted">You&apos;re all caught up for today.</p>
      ) : (
        <div className="mt-2 space-y-0.5">
          {activeShown.map((it) => (
            <ItemRow key={it.canvasId} item={it} lead={it.canvasId === leadId} done={false} glow={false} onSelect={onSelect} />
          ))}
          {studyShown.map((b, i) => (
            <div key={`s${b.canvasId}-${i}`} className="flex items-center gap-3.5 rounded-xl px-3 py-3.5">
              <StatusDisc kind="study" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium text-ink">Study: {b.name}</span>
                <span className="block truncate text-[13px] text-muted">Study block · self-scheduled</span>
              </span>
              <span className="shrink-0 text-[13px] font-medium text-success">{fmtHours(b.hours)}</span>
            </div>
          ))}
          {doneShown.map((it) => (
            <ItemRow key={it.canvasId} item={it} lead={false} done glow={newlyDone.has(it.canvasId)} onSelect={onSelect} />
          ))}
        </div>
      )}
      {overflowText && (
        <Link href="/calendar" className="mt-3 block text-sm font-medium text-accent hover:underline">
          {overflowText} → Open day in Calendar ›
        </Link>
      )}
    </div>
  );
}

function WeekCard({ data }: { data: CalendarData }) {
  const windowDates = new Set(data.plan.days.map((d) => d.date));
  const dueThisWeek = data.items.filter((it) => it.dueAt && windowDates.has(ymd(new Date(it.dueAt))));
  const examQuiz = dueThisWeek.filter((it) => it.type === "exam" || it.type === "quiz").length;
  const planned = round1(data.plan.days.reduce((s, d) => s + d.allocated, 0));
  const budget = data.hoursPerDay * data.plan.days.length;
  const work = round1(planned + data.overloadHours);
  const over = data.overloadHours >= 1;
  // "free" must net out the overload too, or an over-subscribed week could claim
  // free hours and contradict the "Nh over" pill. (#2)
  const free = round1(Math.max(0, budget - work));

  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-ink">This week</h2>
      <p className="mt-3 text-[32px] font-bold leading-none tracking-tight text-accent">
        {fmtHours(work)} <span className="text-sm font-normal text-muted">of work</span>
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2.5 text-sm">
        {over ? (
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${toneSoft.warning}`}>{Math.round(data.overloadHours)}h over</span>
        ) : (
          <span className="text-muted">{fmtHours(free)} free</span>
        )}
      </div>
      <p className="mt-3 border-t border-line-subtle pt-3 text-sm text-muted">
        {dueThisWeek.length} due · {examQuiz} exams / quizzes
      </p>
    </div>
  );
}

function OverdueCard({ atRisk }: { atRisk: CalendarData["atRisk"] }) {
  if (atRisk.length === 0) return null;
  return (
    <div className="card border-danger/30 p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold text-danger">
        <span className="h-2.5 w-2.5 rounded-full bg-danger" aria-hidden /> Overdue ({atRisk.length})
      </h2>
      <ul className="mt-3.5 space-y-3">
        {atRisk.map((a) => (
          <li key={a.canvasId} className="flex items-center justify-between gap-2">
            {a.htmlUrl ? (
              <a href={a.htmlUrl} target="_blank" rel="noreferrer" className="min-w-0 truncate text-[15px] text-ink hover:text-accent">
                {a.name}
              </a>
            ) : (
              <span className="min-w-0 truncate text-[15px] text-ink">{a.name}</span>
            )}
            <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${toneSoft.danger}`}>Past due</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConnectCard() {
  return (
    <div className="card mx-auto max-w-xl p-10 text-center">
      <div className="flex justify-center text-accent">
        <Glyph d={ICON.calendar} size={36} />
      </div>
      <p className="mt-4 text-base font-medium text-ink">Welcome to StudyPlan.</p>
      <p className="mt-1.5 text-sm text-muted">Connect your Canvas account and we&apos;ll turn your coursework into a calm, day-by-day plan.</p>
      <Link href="/connections" className="btn-primary mt-5">
        Connect Canvas
      </Link>
    </div>
  );
}
