"use client";

// The Dashboard — a single-focus "command screen". One unmistakable "do this
// now, and here's why" module up top, a priority-ranked Today list under it, and
// a slim context rail (this week / overdue / jump links). Urgency is shown by
// color, type by icon+label. Distilled from loadCalendarData; links into the
// Calendar/Timeline for the dense detail. (UX redesign spec, June.)

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ymd, parseYmd } from "@/lib/calendarDates";
import { round1 } from "@/lib/round";
import { toneSoft } from "@/lib/tone";
import { ItemDetail, CoachLine, Glyph, ICON, fmtHours, fmtTime } from "@/components/calendar/parts";
import type { CalendarData, CalendarItem } from "@/lib/calendarData";
import type { ItemType } from "@/lib/itemType";
import type { ScoredAssignment } from "@/lib/priority";

const TODAY_MAX = 6;
const TYPE_META: Record<ItemType, { label: string; icon: string }> = {
  assignment: { label: "Assignment", icon: ICON.doc },
  quiz: { label: "Quiz", icon: ICON.quiz },
  exam: { label: "Exam", icon: ICON.quiz },
  other: { label: "Task", icon: ICON.chat },
};

export function DashboardView({ data, todayYmd, firstName }: { data: CalendarData; todayYmd: string; firstName: string }) {
  const router = useRouter();
  const [greeting, setGreeting] = useState("Hello"); // neutral on first render → no hydration mismatch
  const [selected, setSelected] = useState<CalendarItem | null>(null);
  const didAutoSync = useRef(false);

  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
  }, []);

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
  const dateLabel = today.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="mx-auto max-w-5xl">
      {/* Demoted greeting + date — one quiet line (the focal task is the hero now). */}
      <p className="mb-5 text-sm text-muted">
        <span className="font-medium text-ink">
          {greeting}
          {firstName ? `, ${firstName}` : ""}.
        </span>{" "}
        {dateLabel}
      </p>

      {!data.connected ? (
        <ConnectCard />
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          <div className="min-w-0 flex-1 space-y-4">
            <FocusModule data={data} todayYmd={todayYmd} onSelect={setSelected} />
            <TodayCard data={data} todayYmd={todayYmd} today={today} onSelect={setSelected} />
          </div>
          <aside className="w-full shrink-0 space-y-4 lg:w-80">
            <WeekCard data={data} />
            <OverdueCard atRisk={data.atRisk} />
            <QuickLinks />
          </aside>
        </div>
      )}

      {selected && <ItemDetail item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Chip({ text, tone }: { text: string; tone: "danger" | "warning" | "neutral" }) {
  const cls = tone === "danger" ? toneSoft.danger : tone === "warning" ? toneSoft.warning : "bg-surface-soft text-muted";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{text}</span>;
}

function itemChips(item: CalendarItem, todayYmd: string): { text: string; tone: "danger" | "warning" | "neutral" }[] {
  const out: { text: string; tone: "danger" | "warning" | "neutral" }[] = [];
  if (item.status === "overdue") out.push({ text: "Overdue", tone: "danger" });
  else if (item.dueAt && ymd(new Date(item.dueAt)) === todayYmd) out.push({ text: `Due ${fmtTime(item.dueAt)}`, tone: "warning" });
  else if (item.dueAt) out.push({ text: `Due ${new Date(item.dueAt).toLocaleDateString(undefined, { weekday: "short" })}`, tone: "neutral" });
  out.push({ text: TYPE_META[item.type].label, tone: "neutral" });
  if (item.pointsPossible != null) out.push({ text: `${item.pointsPossible} pts`, tone: "neutral" });
  if (item.estimatedEffortHours != null && item.estimatedEffortHours > 0) out.push({ text: `~${fmtHours(item.estimatedEffortHours)}`, tone: "neutral" });
  return out;
}

function FocusModule({ data, todayYmd, onSelect }: { data: CalendarData; todayYmd: string; onSelect: (it: CalendarItem) => void }) {
  const top = data.recommendations[0] as ScoredAssignment | undefined;
  const topItem = top ? data.items.find((it) => it.canvasId === top.canvasId) : undefined;
  const next = data.recommendations[1] as ScoredAssignment | undefined;

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
            : "You have overdue work in the rail, but nothing else is queued up. Catch up when you're ready."}
        </p>
      </div>
    );
  }

  return (
    <div className="card border-accent-soft bg-accent-soft/30 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">Focus now</p>
          <button onClick={() => topItem && onSelect(topItem)} className="mt-1 block w-full text-left" disabled={!topItem}>
            <span className="block text-[13px] text-muted">{top.courseName}</span>
            <span className="mt-0.5 block text-[1.7rem] font-bold leading-tight tracking-tight text-ink">{top.name}</span>
          </button>
          {topItem ? (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {itemChips(topItem, todayYmd).map((c, i) => (
                <Chip key={i} text={c.text} tone={c.tone} />
              ))}
            </div>
          ) : top.reason ? (
            <p className="mt-2 text-sm text-muted">{top.reason}</p>
          ) : null}
          <CoachLine start={todayYmd} days={1} />
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
            <Link href="/timeline" className="btn-ghost text-sm">
              See my plan ›
            </Link>
          </div>
        </div>
        {next && (
          <div className="shrink-0 rounded-lg border border-line-subtle bg-surface/70 p-3 sm:w-44">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Next up</p>
            <p className="mt-1 text-xs text-muted">{next.courseName}</p>
            <p className="truncate text-sm font-medium text-ink">{next.name}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function TodayRow({ item, lead, onSelect }: { item: CalendarItem; lead: boolean; onSelect: (it: CalendarItem) => void }) {
  const t = TYPE_META[item.type];
  const timeColor = item.status === "overdue" ? "text-danger" : "text-muted";
  return (
    <button
      onClick={() => onSelect(item)}
      className={`flex w-full items-center gap-3 rounded-md py-3 pr-1 text-left transition hover:bg-surface-soft ${
        lead ? "border-l-2 border-accent pl-2.5" : "pl-1"
      }`}
    >
      <span className="shrink-0 text-muted">
        <Glyph d={t.icon} size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[15px] text-ink ${lead ? "font-semibold" : "font-medium"}`}>{item.name}</span>
        <span className="block truncate text-[13px] text-muted">
          {t.label} · {item.courseName}
        </span>
      </span>
      {item.dueAt && <span className={`shrink-0 text-[13px] font-medium ${timeColor}`}>{fmtTime(item.dueAt)}</span>}
    </button>
  );
}

function TodayCard({
  data,
  todayYmd,
  today,
  onSelect,
}: {
  data: CalendarData;
  todayYmd: string;
  today: Date;
  onSelect: (it: CalendarItem) => void;
}) {
  const items = data.items
    .filter((it) => it.dueAt && ymd(new Date(it.dueAt)) === todayYmd)
    .sort((a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime());
  const study = (data.plan.days.find((d) => d.date === todayYmd)?.blocks ?? []).filter((b) => b.study);
  const busyCount = data.events.filter((e) => ymd(new Date(e.startTime)) === todayYmd).length;

  const shownItems = items.slice(0, TODAY_MAX);
  const shownStudy = study.slice(0, Math.max(0, TODAY_MAX - shownItems.length));
  const hidden = items.length - shownItems.length + (study.length - shownStudy.length);
  const overflow = [hidden > 0 ? `${hidden} more` : "", busyCount > 0 ? `${busyCount} busy` : ""].filter(Boolean);

  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold text-ink">Today</h2>
        <span className="text-[13px] text-muted">{today.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
      </div>
      <div className="mt-1.5 divide-y divide-line-subtle/70">
        {items.length === 0 && study.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">You&apos;re all caught up for today.</p>
        ) : (
          <>
            {shownItems.map((it, i) => (
              <TodayRow key={it.canvasId} item={it} lead={i === 0} onSelect={onSelect} />
            ))}
            {shownStudy.map((b, i) => (
              <div key={`st-${b.canvasId}-${i}`} className="flex w-full items-center gap-3 py-3 pl-1 pr-1 text-left">
                <span className="shrink-0 text-muted">
                  <Glyph d={ICON.clock} size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-ink">Study: {b.name}</span>
                  <span className="block truncate text-[13px] text-muted">Study · {b.courseName}</span>
                </span>
                <span className="shrink-0 text-[13px] font-medium text-muted">{fmtHours(b.hours)}</span>
              </div>
            ))}
          </>
        )}
      </div>
      {overflow.length > 0 && (
        <Link href="/calendar" className="mt-2 block text-[13px] text-muted hover:text-accent">
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
      <p className="mt-2 text-2xl font-bold tracking-tight text-ink">
        {fmtHours(work)} <span className="text-sm font-normal text-muted">of work</span>
      </p>
      <p className={`text-[13px] ${over ? "font-medium text-warning" : "text-muted"}`}>
        {over ? `~${Math.round(data.overloadHours)}h over your budget` : `${fmtHours(free)} free this week`}
      </p>
      <p className="mt-2 text-[13px] text-muted">
        {dueThisWeek.length} due · {examQuiz} exam/quiz
      </p>
    </div>
  );
}

function OverdueCard({ atRisk }: { atRisk: CalendarData["atRisk"] }) {
  if (atRisk.length === 0) return null;
  return (
    <div className="card border-danger/30 p-5">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-danger">
        <Glyph d={ICON.alert} size={15} /> Overdue ({atRisk.length})
      </h2>
      <ul className="mt-2.5 space-y-2">
        {atRisk.map((a) => (
          <li key={a.canvasId} className="min-w-0 text-[13px]">
            {a.htmlUrl ? (
              <a href={a.htmlUrl} target="_blank" rel="noreferrer" className="block truncate font-medium text-ink hover:text-accent">
                {a.name}
              </a>
            ) : (
              <span className="block truncate font-medium text-ink">{a.name}</span>
            )}
            <span className="block truncate text-muted">{a.courseName}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function QuickLinks() {
  return (
    <div className="card space-y-1 p-3">
      <Link href="/calendar" className="block rounded-md px-2 py-2 text-sm text-ink transition hover:bg-surface-soft">
        Open calendar →
      </Link>
      <Link href="/timeline" className="block rounded-md px-2 py-2 text-sm text-ink transition hover:bg-surface-soft">
        Jump to timeline →
      </Link>
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
