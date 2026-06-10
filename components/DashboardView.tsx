"use client";

// The Dashboard — the calm landing a student sees first. A single narrow column:
// greeting + AI coach line, an overdue strip (only when needed), the ONE most
// important next thing, a short "Today" list, and a quiet "this week" pulse.
// It only distills; the Calendar/Timeline own the dense detail and it links out.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ymd, parseYmd } from "@/lib/calendarDates";
import { courseColor } from "@/lib/courseColor";
import { AttentionBanner, ItemPill, ItemDetail, CoachLine, Glyph, ICON, fmtHours } from "@/components/calendar/parts";
import type { CalendarData, CalendarItem } from "@/lib/calendarData";

const TODAY_MAX = 4;

export function DashboardView({ data, todayYmd, firstName }: { data: CalendarData; todayYmd: string; firstName: string }) {
  const router = useRouter();
  const [greeting, setGreeting] = useState("Hello"); // neutral on first render → no hydration mismatch
  const [selected, setSelected] = useState<CalendarItem | null>(null);
  const didAutoSync = useRef(false);

  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
  }, []);

  // Sync Canvas once per browser session — shared key with the Calendar so it
  // fires exactly once regardless of which page the student lands on first.
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
  const dateLabel = today.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Zone 1 — greeting + AI coach */}
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting}
            {firstName ? `, ${firstName}` : ""}.
          </h1>
          <span className="text-sm text-muted">{dateLabel}</span>
        </div>
        {data.connected && <CoachLine start={todayYmd} days={1} />}
      </div>

      {!data.connected ? (
        <div className="card p-8 text-center">
          <div className="flex justify-center text-accent">
            <Glyph d={ICON.calendar} size={32} />
          </div>
          <p className="mt-3 text-sm font-medium text-ink">Welcome to StudyPlan.</p>
          <p className="mt-1 text-sm text-muted">Connect your Canvas account and we&apos;ll turn your coursework into a calm, day-by-day plan.</p>
          <Link href="/connections" className="btn-primary mt-4">
            Connect Canvas
          </Link>
        </div>
      ) : (
        <>
          <AttentionBanner atRisk={data.atRisk} />
          <RightNow data={data} onSelect={setSelected} />
          <Today data={data} todayYmd={todayYmd} today={today} onSelect={setSelected} />
          <ThisWeek data={data} />
        </>
      )}

      {selected && <ItemDetail item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function RightNow({ data, onSelect }: { data: CalendarData; onSelect: (it: CalendarItem) => void }) {
  const rec = data.recommendations[0];
  const item = rec ? data.items.find((it) => it.canvasId === rec.canvasId) ?? null : null;
  const allClear = data.recommendations.length === 0 && data.atRisk.length === 0;

  if (!rec) {
    if (!allClear) return null; // nothing to spotlight, but not fully clear (e.g. only undated) — stay quiet
    return (
      <div className="card p-6 text-center">
        <div className="flex justify-center text-success">
          <Glyph d={ICON.check} size={28} />
        </div>
        <p className="mt-2 text-base font-semibold text-ink">You&apos;re all caught up.</p>
        <p className="mt-1 text-sm text-muted">Nothing&apos;s due and nothing&apos;s overdue. Enjoy the breathing room — we&apos;ll nudge you when something lands.</p>
      </div>
    );
  }

  return (
    <div className="card border-accent-soft bg-accent-soft/30 p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-accent">Right now</p>
      <button onClick={() => item && onSelect(item)} className="mt-1.5 flex w-full items-start gap-2.5 text-left" disabled={!item}>
        <span className="mt-1 h-4 w-1 shrink-0 rounded-full" style={{ background: courseColor(rec.courseName) }} aria-hidden />
        <span className="min-w-0">
          <span className="block text-xs text-muted">{rec.courseName}</span>
          <span className="block text-lg font-semibold leading-snug text-ink">{rec.name}</span>
          {rec.reason && <span className="mt-0.5 block text-sm text-muted">{rec.reason}</span>}
        </span>
      </button>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        {item ? (
          <button onClick={() => onSelect(item)} className="btn-primary text-sm">
            Open
          </button>
        ) : rec.htmlUrl ? (
          <a href={rec.htmlUrl} target="_blank" rel="noreferrer" className="btn-primary text-sm">
            Open ↗
          </a>
        ) : null}
        <Link href="/timeline" className="btn-ghost text-sm">
          See my plan ›
        </Link>
      </div>
    </div>
  );
}

function Today({
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
    <div className="card p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-ink">Today</h2>
        <span className="text-xs text-muted">{today.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</span>
      </div>
      <div className="mt-2.5 space-y-1.5">
        {items.length === 0 && study.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">Nothing due today — enjoy it.</p>
        ) : (
          <>
            {shownItems.map((it) => (
              <ItemPill key={it.canvasId} item={it} onSelect={onSelect} />
            ))}
            {shownStudy.map((b, i) => (
              <div key={`st-${b.canvasId}-${i}`} className="flex items-center gap-2 rounded-md border border-line-subtle bg-surface px-1.5 py-1 text-xs">
                <span className="h-3.5 w-1 shrink-0 rounded-full" style={{ background: courseColor(b.courseName) }} aria-hidden />
                <span className="mt-px shrink-0 text-muted">
                  <Glyph d={ICON.clock} size={12} />
                </span>
                <span className="min-w-0 flex-1 truncate text-ink">Study: {b.name}</span>
                <span className="shrink-0 text-muted">{fmtHours(b.hours)}</span>
              </div>
            ))}
            {overflow.length > 0 && (
              <Link href="/calendar" className="block rounded-md px-1.5 py-1 text-xs text-muted hover:bg-surface-soft">
                {overflow.join(" · ")} → Open day in Calendar ›
              </Link>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ThisWeek({ data }: { data: CalendarData }) {
  const windowDates = new Set(data.plan.days.map((d) => d.date));
  const dueThisWeek = data.items.filter((it) => it.dueAt && windowDates.has(ymd(new Date(it.dueAt))));
  const examQuiz = dueThisWeek.filter((it) => it.type === "exam" || it.type === "quiz").length;
  const plannedHours = data.plan.days.reduce((s, d) => s + d.allocated, 0);
  const onTrack = data.overloadHours < 1;

  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-ink">This week</h2>
        <Link href="/timeline" className="text-xs font-medium text-accent hover:underline">
          See timeline ›
        </Link>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-lg font-semibold text-ink">{dueThisWeek.length}</p>
          <p className="text-xs text-muted">due</p>
        </div>
        <div>
          <p className="text-lg font-semibold text-ink">{examQuiz}</p>
          <p className="text-xs text-muted">exam / quiz</p>
        </div>
        <div>
          <p className={`text-lg font-semibold ${onTrack ? "text-ink" : "text-warning"}`}>
            {onTrack ? "On track" : `~${Math.round(data.overloadHours)}h over`}
          </p>
          <p className="text-xs text-muted">{fmtHours(plannedHours)} planned</p>
        </div>
      </div>
    </div>
  );
}
