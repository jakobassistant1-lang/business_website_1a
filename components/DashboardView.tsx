"use client";

// The Dashboard — a single-focus "command screen" matching the June UX mock:
// a violet Focus module (the #1 task big, with structured reason-chips + a short
// rationale + Next-up), a priority-ranked Today list with check-off circles, and
// a context rail (This week / Overdue / jump links). Distilled from
// loadCalendarData; links into the Calendar/Timeline for detail.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ymd, parseYmd } from "@/lib/calendarDates";
import { round1 } from "@/lib/round";
import { toneSoft } from "@/lib/tone";
import { ItemDetail, Glyph, ICON, fmtHours, fmtTime } from "@/components/calendar/parts";
import type { CalendarData, CalendarItem } from "@/lib/calendarData";
import type { ItemType } from "@/lib/itemType";
import type { ScoredAssignment } from "@/lib/priority";

const TODAY_MAX = 6;
const TYPE_LABEL: Record<ItemType, string> = { assignment: "Assignment", quiz: "Quiz", exam: "Exam", other: "Task" };
const shortCourse = (name: string) => name.split(" · ")[0];

export function DashboardView({ data, todayYmd, firstName }: { data: CalendarData; todayYmd: string; firstName: string }) {
  const router = useRouter();
  const [greeting, setGreeting] = useState("Hello"); // neutral on first render → no hydration mismatch
  const [selected, setSelected] = useState<CalendarItem | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const didAutoSync = useRef(false);

  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
  }, []);

  // Personal "checked off today" state — local + per-day (not a Canvas submission).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`sp_done_${todayYmd}`);
      if (raw) setDone(new Set(JSON.parse(raw)));
    } catch {
      /* ignore */
    }
  }, [todayYmd]);
  function toggleDone(key: string) {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(`sp_done_${todayYmd}`, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  // Sync Canvas once per browser session (shared key with the Calendar).
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

  const today = parseYmd(todayYmd);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[15px] text-muted">
          {greeting}
          {firstName ? `, ${firstName}` : ""}
        </p>
        <p className="text-[15px] text-muted">{today.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</p>
      </div>

      {!data.connected ? (
        <ConnectCard />
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="min-w-0 flex-1 space-y-4">
            <FocusModule data={data} todayYmd={todayYmd} onSelect={setSelected} />
            <TodayCard data={data} todayYmd={todayYmd} today={today} done={done} onToggle={toggleDone} onSelect={setSelected} />
          </div>
          <aside className="w-full shrink-0 space-y-4 lg:w-80">
            <WeekCard data={data} />
            <OverdueCard atRisk={data.atRisk} />
            <div className="space-y-1.5 px-1">
              <Link href="/timeline" className="block text-sm font-medium text-accent hover:underline">
                Jump to timeline →
              </Link>
              <Link href="/calendar" className="block text-sm font-medium text-accent hover:underline">
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

function Chip({ text, tone }: { text: string; tone: "danger" | "warning" | "neutral" }) {
  const cls = tone === "danger" ? toneSoft.danger : tone === "warning" ? toneSoft.warning : "bg-surface-soft text-muted";
  return <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${cls}`}>{text}</span>;
}

function focusChips(item: CalendarItem, todayYmd: string): { text: string; tone: "danger" | "warning" | "neutral" }[] {
  const out: { text: string; tone: "danger" | "warning" | "neutral" }[] = [];
  const dueToday = item.dueAt && ymd(new Date(item.dueAt)) === todayYmd;
  if (item.status === "overdue") out.push({ text: "Overdue", tone: "danger" });
  if (dueToday && item.dueAt) out.push({ text: `Due ${fmtTime(item.dueAt)}`, tone: "warning" });
  else if (item.dueAt && item.status !== "overdue") out.push({ text: `Due ${new Date(item.dueAt).toLocaleDateString(undefined, { weekday: "short" })}`, tone: "neutral" });
  if (item.pointsPossible != null) out.push({ text: `${item.pointsPossible} pts`, tone: "neutral" });
  return out;
}

function focusRationale(item: CalendarItem, todayYmd: string): string {
  const dueToday = item.dueAt && ymd(new Date(item.dueAt)) === todayYmd;
  const parts: string[] = [];
  if (item.pointsPossible != null) parts.push(`Worth ${item.pointsPossible} pts`);
  if (item.status === "overdue") parts.push("past due");
  else if (dueToday) parts.push("due today");
  const lead = parts.length ? parts.join(" and ") : item.name;
  const tail = item.status === "overdue" ? " — clear this first." : dueToday ? " — knock it out today." : " — a strong place to start.";
  return lead + tail;
}

function FocusModule({ data, todayYmd, onSelect }: { data: CalendarData; todayYmd: string; onSelect: (it: CalendarItem) => void }) {
  const top = data.recommendations[0] as ScoredAssignment | undefined;
  const topItem = top ? data.items.find((it) => it.canvasId === top.canvasId) : undefined;
  const nextRecs = data.recommendations.slice(1, 3) as ScoredAssignment[];

  if (!top) {
    const allClear = data.atRisk.length === 0;
    return (
      <div className="card p-7 text-center">
        <div className="flex justify-center text-success">
          <Glyph d={ICON.check} size={30} />
        </div>
        <p className="mt-2.5 text-lg font-semibold text-ink">{allClear ? "You're all caught up." : "Nothing to start right now."}</p>
        <p className="mt-1 text-sm text-muted">
          {allClear
            ? "Nothing's due and nothing's overdue. Enjoy the breathing room — we'll nudge you when something lands."
            : "You have overdue work in the rail, but nothing else is queued. Catch up when you're ready."}
        </p>
      </div>
    );
  }

  return (
    <div className="card border-accent-soft bg-accent-soft/30 p-5">
      <div className="flex gap-5">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">Focus now</p>
          <button onClick={() => topItem && onSelect(topItem)} className="mt-1 block max-w-full text-left" disabled={!topItem}>
            <span className="block text-[1.7rem] font-bold leading-tight tracking-tight text-ink">{top.name}</span>
          </button>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {(topItem ? focusChips(topItem, todayYmd) : []).map((c, i) => (
              <Chip key={i} text={c.text} tone={c.tone} />
            ))}
          </div>
          <p className="mt-2.5 text-sm text-muted">{topItem ? focusRationale(topItem, todayYmd) : top.reason}</p>
          <div className="mt-3.5 flex flex-col gap-2 sm:flex-row">
            {topItem ? (
              <button onClick={() => onSelect(topItem)} className="btn-primary text-sm">
                Open
              </button>
            ) : top.htmlUrl ? (
              <a href={top.htmlUrl} target="_blank" rel="noreferrer" className="btn-primary text-sm">
                Open ↗
              </a>
            ) : null}
            <Link href="/timeline" className="rounded-[14px] border border-line bg-surface px-4 py-2 text-center text-sm font-medium text-ink transition hover:bg-surface-soft">
              See my plan ›
            </Link>
          </div>
        </div>
        {nextRecs.length > 0 && (
          <div className="hidden w-44 shrink-0 border-l border-line-subtle/80 pl-4 sm:block">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Next up</p>
            <div className="mt-2 space-y-3">
              {nextRecs.map((r) => {
                const it = data.items.find((x) => x.canvasId === r.canvasId);
                return (
                  <div key={r.canvasId} className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{r.name}</p>
                    <p className="truncate text-[13px] text-muted">
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

function Circle({ checked, tone, onClick }: { checked: boolean; tone: "neutral" | "danger" | "success"; onClick: () => void }) {
  const ring = tone === "danger" ? "border-danger/60" : tone === "success" ? "border-success/70" : "border-line";
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-pressed={checked}
      aria-label={checked ? "Mark not done" : "Mark done"}
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition ${checked ? "border-success bg-success text-white" : `${ring} hover:border-success`}`}
    >
      {checked && <Glyph d={ICON.check} size={11} />}
    </button>
  );
}

type Row =
  | { kind: "item"; key: string; item: CalendarItem }
  | { kind: "study"; key: string; name: string; course: string; hours: number };

function RowView({
  row,
  lead,
  done,
  onToggle,
  onSelect,
}: {
  row: Row;
  lead: boolean;
  done: boolean;
  onToggle: (key: string) => void;
  onSelect: (it: CalendarItem) => void;
}) {
  const isItem = row.kind === "item";
  const tone: "neutral" | "danger" | "success" = !isItem ? "success" : row.item.status === "overdue" ? "danger" : "neutral";
  const name = isItem ? row.item.name : `Study: ${row.name}`;
  const sub = isItem ? `${TYPE_LABEL[row.item.type]} · ${shortCourse(row.item.courseName)}` : "Study block · self-scheduled";
  const timeText = isItem ? (row.item.dueAt ? fmtTime(row.item.dueAt) : "") : fmtHours(row.hours);
  const timeColor = !isItem ? "text-success" : row.item.status === "overdue" ? "text-danger" : lead ? "text-warning" : "text-ink";
  return (
    <div className={`flex items-center gap-3 ${lead ? "rounded-lg border-l-2 border-accent bg-accent-soft/40 py-3 pl-2.5 pr-3" : "py-3 pl-1 pr-2"}`}>
      <Circle checked={done} tone={tone} onClick={() => onToggle(row.key)} />
      <button
        onClick={() => isItem && onSelect(row.item)}
        disabled={!isItem}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[15px] ${done ? "text-muted line-through" : "text-ink"} ${lead && !done ? "font-semibold" : "font-medium"}`}>{name}</span>
          <span className="block truncate text-[13px] text-muted">{sub}</span>
        </span>
        <span className={`shrink-0 text-[13px] font-medium ${done ? "text-muted" : timeColor}`}>{timeText}</span>
      </button>
    </div>
  );
}

function TodayCard({
  data,
  todayYmd,
  today,
  done,
  onToggle,
  onSelect,
}: {
  data: CalendarData;
  todayYmd: string;
  today: Date;
  done: Set<string>;
  onToggle: (key: string) => void;
  onSelect: (it: CalendarItem) => void;
}) {
  const items = data.items
    .filter((it) => it.dueAt && ymd(new Date(it.dueAt)) === todayYmd)
    .sort((a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime());
  const study = (data.plan.days.find((d) => d.date === todayYmd)?.blocks ?? []).filter((b) => b.study);
  const busyCount = data.events.filter((e) => ymd(new Date(e.startTime)) === todayYmd).length;

  const rows: Row[] = [
    ...items.map((it): Row => ({ kind: "item", key: `i${it.canvasId}`, item: it })),
    ...study.map((b, i): Row => ({ kind: "study", key: `s${b.canvasId}-${i}`, name: b.name, course: b.courseName, hours: b.hours })),
  ];
  const shown = rows.slice(0, TODAY_MAX);
  const hidden = rows.length - shown.length;
  const overflow = [hidden > 0 ? `${hidden} more` : "", busyCount > 0 ? `${busyCount} busy` : ""].filter(Boolean);

  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-ink">Today</h2>
        <span className="text-[13px] text-muted">{today.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
      </div>
      {shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">You&apos;re all caught up for today.</p>
      ) : (
        <div className="mt-1.5">
          <RowView row={shown[0]} lead done={done.has(shown[0].key)} onToggle={onToggle} onSelect={onSelect} />
          {shown.length > 1 && (
            <div className="divide-y divide-line-subtle/70">
              {shown.slice(1).map((r) => (
                <RowView key={r.key} row={r} lead={false} done={done.has(r.key)} onToggle={onToggle} onSelect={onSelect} />
              ))}
            </div>
          )}
        </div>
      )}
      {overflow.length > 0 && (
        <Link href="/calendar" className="mt-2.5 block text-[13px] font-medium text-accent hover:underline">
          {overflow.join(" · ")} → Open day in Calendar ›
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
  const free = round1(Math.max(0, budget - planned));

  return (
    <div className="card p-5">
      <h2 className="text-base font-semibold text-ink">This week</h2>
      <p className="mt-2 text-[28px] font-bold leading-none tracking-tight text-ink">
        {fmtHours(work)} <span className="text-sm font-normal text-muted">of work</span>
      </p>
      <div className="mt-2.5 flex items-center gap-2.5 text-[13px]">
        {over && <span className={`rounded-full px-2.5 py-0.5 font-medium ${toneSoft.warning}`}>{Math.round(data.overloadHours)}h over</span>}
        <span className="text-muted">{fmtHours(free)} free</span>
      </div>
      <p className="mt-2.5 border-t border-line-subtle/70 pt-2.5 text-[13px] text-muted">
        {dueThisWeek.length} due · {examQuiz} exams / quizzes
      </p>
    </div>
  );
}

function OverdueCard({ atRisk }: { atRisk: CalendarData["atRisk"] }) {
  if (atRisk.length === 0) return null;
  return (
    <div className="card border-danger/30 p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-danger">
        <span className="h-2 w-2 rounded-full bg-danger" aria-hidden /> Overdue ({atRisk.length})
      </h2>
      <ul className="mt-3 space-y-2.5">
        {atRisk.map((a) => (
          <li key={a.canvasId} className="flex items-center justify-between gap-2">
            {a.htmlUrl ? (
              <a href={a.htmlUrl} target="_blank" rel="noreferrer" className="min-w-0 truncate text-sm text-ink hover:text-accent">
                {a.name}
              </a>
            ) : (
              <span className="min-w-0 truncate text-sm text-ink">{a.name}</span>
            )}
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${toneSoft.danger}`}>Past due</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConnectCard() {
  return (
    <div className="card mx-auto max-w-xl p-8 text-center">
      <div className="flex justify-center text-accent">
        <Glyph d={ICON.calendar} size={32} />
      </div>
      <p className="mt-3 text-sm font-medium text-ink">Welcome to StudyPlan.</p>
      <p className="mt-1 text-sm text-muted">Connect your Canvas account and we&apos;ll turn your coursework into a calm, day-by-day plan.</p>
      <Link href="/connections" className="btn-primary mt-4">
        Connect Canvas
      </Link>
    </div>
  );
}
