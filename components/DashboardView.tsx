"use client";

// The Dashboard — a calm, wide "command screen". Top: an AI summary of the week,
// then a quiet bar of KPIs (week intensity, overdue → opens the full list) with
// the Timeline/Calendar jumps. Below: ONE card whose flush violet Focus block
// (the #1 task) sits above a 7-day "what's coming up" list; a bare progress ring +
// an Upcoming-assessments card into /study sit in the rail.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ymd, parseYmd, WEEKDAYS, WEEKDAYS_FULL, MONTHS_LONG, countdownLabel } from "@/lib/calendarDates";
import { round1 } from "@/lib/round";
import { toneSoft } from "@/lib/tone";
import { deterministicIntensity, type Intensity } from "@/lib/intensity";
import { Glyph, ICON, fmtTime, fmtHours, EffortTag } from "@/components/calendar/parts";
import type { CalendarData, CalendarItem } from "@/lib/calendarData";
import { itemHref, TYPE_LABEL } from "@/lib/itemType";
import { shortCourse } from "@/lib/courseName";

const FOCUS_LIST_MAX = 5;
const fmtLongDate = (d: Date) => `${WEEKDAYS_FULL[d.getDay()]}, ${MONTHS_LONG[d.getMonth()]} ${d.getDate()}`;

export function DashboardView({ data, todayYmd: serverToday, firstName, demo = false }: { data: CalendarData; todayYmd: string; firstName: string; demo?: boolean }) {
  const router = useRouter();
  const [greeting, setGreeting] = useState("Hello"); // neutral on first render → no hydration mismatch
  const [todayYmd, setTodayYmd] = useState(serverToday);
  const [showOverdue, setShowOverdue] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiIntensity, setAiIntensity] = useState<Intensity | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const didAutoSync = useRef(false);

  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
    const t = ymd(new Date());
    if (t !== serverToday) setTodayYmd(t);
  }, [serverToday]);

  // Sync Canvas once per browser session (shared key with the Calendar).
  useEffect(() => {
    if (demo) return; // demo runs on mock data — never touch the network
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

  // AI summary + Gemini week rating (fail-open: deterministic rating already shows;
  // this upgrades it + fills the summary line when Gemini answers).
  useEffect(() => {
    if (demo || !data.connected) return;
    let cancelled = false;
    setSummaryLoading(true);
    fetch("/api/dashboard-summary")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled || !body) return;
        if (typeof body.summary === "string") setAiSummary(body.summary);
        if (body.intensity === "easy" || body.intensity === "moderate" || body.intensity === "hard") setAiIntensity(body.intensity);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [data.connected]);

  const today = parseYmd(todayYmd);
  const isDueToday = (it: CalendarItem) => it.dueAt != null && ymd(new Date(it.dueAt)) === todayYmd;

  // Today's-progress ring counts (today's submitted vs total due today).
  const dueTodayActive = data.items.filter((it) => it.status !== "done" && isDueToday(it)).length;
  const dueTodayDone = data.completed.filter(isDueToday).length;
  const dialTotal = dueTodayActive + dueTodayDone;

  // Do-next ordering — EVERYTHING on the dashboard follows the importance ranking
  // (lib/priority), never the clock. That intelligent order is the product's value;
  // due dates are shown as context, never used as the sort key.
  const rank = new Map(data.ranked.map((r, i) => [r.canvasId, i] as const));
  const byRank = (a: CalendarItem, b: CalendarItem) => (rank.get(a.canvasId) ?? 1e9) - (rank.get(b.canvasId) ?? 1e9);

  const focusId = data.recommendations[0]?.canvasId;
  // The do-next queue beneath the #1 Focus item: the next most important work, in
  // the order to tackle it.
  const doNext = data.items.filter((it) => it.status === "normal" && it.canvasId !== focusId).sort(byRank).slice(0, FOCUS_LIST_MAX);

  // Overdue, most-important-first — surfaced as an action, not just a count.
  const overdueItems = data.items.filter((it) => it.status === "overdue").sort(byRank);

  // Today's scheduled study sessions (restored to the dashboard).
  const todayStudy = (data.plan.days.find((d) => d.date === todayYmd)?.blocks ?? []).filter((b) => b.study && b.hours > 0 && ymd(new Date(b.dueAt)) >= todayYmd);

  // Week intensity — deterministic baseline (instant), upgraded by Gemini when it answers.
  const windowDates = new Set(data.plan.days.map((d) => d.date));
  const dueThisWeek = data.items.filter((it) => it.dueAt && windowDates.has(ymd(new Date(it.dueAt))));
  const examQuizWeek = dueThisWeek.filter((it) => it.type === "exam" || it.type === "quiz").length;
  const plannedHours = data.plan.days.reduce((s, d) => s + d.allocated, 0);
  const budgetHours = round1(data.hoursPerDay * data.plan.days.length);
  const workHours = round1(plannedHours + data.overloadHours);
  const baseIntensity = deterministicIntensity({
    dueThisWeek: dueThisWeek.length,
    examQuiz: examQuizWeek,
    workHours,
    budgetHours,
    overloadHours: data.overloadHours,
  });
  const intensity = aiIntensity ?? baseIntensity;

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6">
        <p className="text-[22px] font-semibold text-ink">
          {greeting}
          {firstName ? `, ${firstName}` : ""}
        </p>
        <p className="mt-0.5 text-[15px] text-muted">{fmtLongDate(today)}</p>
      </div>

      {!data.connected ? (
        <ConnectCard />
      ) : (
        <>
          <AiSummary text={aiSummary} loading={summaryLoading} />

          {/* KPI bar — quiet at-a-glance status against the page. */}
          <div className="mb-7 flex flex-wrap items-center gap-x-12 gap-y-4 border-b border-line-subtle pb-5">
            <div data-tour="dash-week"><IntensityKpi intensity={intensity} /></div>
            <OverdueKpi count={data.atRisk.length} onOpen={() => setShowOverdue(true)} />
          </div>

          <div className="flex flex-col gap-6 lg:flex-row">
            <div className="min-w-0 flex-1 space-y-6">
              <div data-tour="dash-focus"><FocusTodayCard data={data} todayYmd={todayYmd} list={doNext} /></div>
              {overdueItems.length > 0 && <CatchUpCard items={overdueItems} onOpenAll={() => setShowOverdue(true)} />}
            </div>
            <aside className="w-full shrink-0 space-y-7 lg:w-96">
              <div data-tour="dash-progress"><ProgressDial done={dueTodayDone} total={dialTotal} /></div>
              {todayStudy.length > 0 && <TodayStudyCard blocks={todayStudy} />}
              <div data-tour="dash-tests"><UpcomingTestsCard data={data} todayYmd={todayYmd} /></div>
            </aside>
          </div>
        </>
      )}

      {showOverdue && <OverdueModal atRisk={data.atRisk} onClose={() => setShowOverdue(false)} />}
    </div>
  );
}

// ── AI summary banner — fail-open: renders nothing once we know there's no text. ─
function AiSummary({ text, loading }: { text: string | null; loading: boolean }) {
  if (!text && !loading) return null;
  return (
    <div className="mb-6 flex items-start gap-3 rounded-2xl border border-line-subtle bg-surface-soft/60 p-4">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2z" />
        </svg>
      </span>
      <p className="text-[16px] leading-relaxed text-ink">{text ?? <span className="text-muted">Reading your week…</span>}</p>
    </div>
  );
}

// ── KPIs (card-less, quiet) ────────────────────────────────────────────────────
const KPI_LABEL = "text-[12px] font-semibold uppercase tracking-wider text-muted";

function IntensityKpi({ intensity }: { intensity: Intensity }) {
  const cfg = {
    easy: { word: "Easy", soft: toneSoft.success, dot: "bg-success" },
    moderate: { word: "Moderate", soft: toneSoft.warning, dot: "bg-warning" },
    hard: { word: "Hard", soft: toneSoft.danger, dot: "bg-danger" },
  }[intensity];
  return (
    <div>
      <p className={KPI_LABEL}>This week</p>
      <span className={`mt-1.5 inline-flex items-center gap-2 rounded-full px-3 py-1 ${cfg.soft}`}>
        <span className={`h-2.5 w-2.5 rounded-full ${cfg.dot}`} aria-hidden />
        <span className="text-[17px] font-bold leading-none">{cfg.word}</span>
      </span>
    </div>
  );
}

function OverdueKpi({ count, onOpen }: { count: number; onOpen: () => void }) {
  if (count === 0) {
    return (
      <div>
        <p className={KPI_LABEL}>Overdue</p>
        <p className="mt-1.5 text-[26px] font-bold leading-none text-ink">0</p>
      </div>
    );
  }
  return (
    <button onClick={onOpen} className="group text-left" title="View overdue items">
      <p className={KPI_LABEL}>Overdue</p>
      <p className="mt-1.5 text-[26px] font-bold leading-none text-danger">{count}</p>
      <span className="mt-1 inline-block text-[13px] font-medium text-danger group-hover:underline">View all ›</span>
    </button>
  );
}

// ── Daily-progress ring (unchanged math; bare on the page, no card). ────────────
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

function ProgressDial({ done, total }: { done: number; total: number }) {
  return (
    <div>
      <p className={`mb-2 ${KPI_LABEL}`}>Today&apos;s progress</p>
      <div className="flex justify-center">
        <ProgressRing done={done} total={total} />
      </div>
    </div>
  );
}

// A reason-chip on the violet Focus block (white-on-accent is the only variant).
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

// Empty status disc — mirrors Canvas (fills to a green check there once submitted).
function StatusDisc() {
  return <span className="h-[22px] w-[22px] shrink-0 rounded-full border-2 border-line" aria-hidden />;
}

function ItemRow({ item, dueLabel }: { item: CalendarItem; dueLabel: string }) {
  return (
    <Link href={itemHref(item.canvasId, item.type, item.status)} className="flex items-center gap-3.5 rounded-xl px-3 py-3 transition hover:bg-surface-soft/60">
      <StatusDisc />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-medium text-ink">{item.name}</span>
        <span className="flex items-center gap-1.5 text-[14px] text-muted">
          <span className="truncate">
            {TYPE_LABEL[item.type]} · {shortCourse(item.courseName)}
          </span>
          <EffortTag hours={item.estimatedEffortHours} className="shrink-0" />
        </span>
      </span>
      <span className="shrink-0 text-[14px] font-medium text-ink">{dueLabel}</span>
    </Link>
  );
}

// ── Focus + what's next: a flush, rounded-bottom violet Focus block (the #1 task)
// sits edge-to-edge atop a 7-day due list, all in one card. ─────────────────────
function FocusTodayCard({ data, todayYmd, list }: { data: CalendarData; todayYmd: string; list: CalendarItem[] }) {
  const topRec = data.recommendations[0];
  const fromRec = topRec ? data.items.find((it) => it.canvasId === topRec.canvasId) : undefined;
  // When there are no forward recommendations (e.g. all active work is undated or
  // far-future), fall back to the do-next #1 from the list — never show "all caught
  // up" above a list that still has items. `list` already excludes the rec focus, so
  // when we fall back we drop its head to avoid showing it twice.
  const focusItem = fromRec ?? list[0];
  const restList = fromRec ? list : list.slice(1);
  const isToday = !!focusItem?.dueAt && ymd(new Date(focusItem.dueAt)) === todayYmd;
  const caughtUp = data.atRisk.length === 0;
  const href = focusItem ? itemHref(focusItem.canvasId, focusItem.type, focusItem.status) : null;

  return (
    <div className="card overflow-hidden p-0">
      {focusItem && href ? (
        <div className="rounded-b-2xl bg-accent px-6 py-6 text-white sm:px-8 sm:py-7">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-white/80">Focus now</p>
          <Link href={href} className="mt-1.5 block max-w-full text-left">
            <span className="block text-[1.9rem] font-bold leading-[1.12] tracking-tight sm:text-[2.15rem]">{focusItem.name}</span>
          </Link>
          <div className="mt-3 flex flex-wrap gap-2">
            {focusChips(focusItem, isToday).map((c, i) => (
              <Chip key={i} text={c} />
            ))}
          </div>
          <p className="mt-3 text-[16px] text-white/90">{focusRationale(focusItem, isToday)}</p>
          <div className="mt-5">
            <Link href={href} className="inline-block rounded-[14px] bg-white px-5 py-2.5 text-[15px] font-semibold text-accent transition hover:bg-white/90">
              Open
            </Link>
          </div>
        </div>
      ) : (
        <div className="rounded-b-2xl bg-surface-soft/70 px-6 py-8 text-center">
          <div className="flex justify-center text-success">
            <Glyph d={ICON.check} size={30} />
          </div>
          <p className="mt-2 text-xl font-semibold text-ink">{caughtUp ? "You're all caught up." : "Nothing new queued up."}</p>
          <p className="mx-auto mt-1 max-w-md text-[15px] text-muted">
            {caughtUp ? "Nothing's due and nothing's overdue — enjoy the breathing room." : "Your upcoming work is clear; chip away at the overdue items when you're ready."}
          </p>
        </div>
      )}

      <div className="p-3 sm:p-4">
        {restList.length === 0 ? (
          <p className="py-4 text-center text-[15px] text-muted">Nothing else queued up.</p>
        ) : (
          <div className="space-y-0.5">
            {restList.map((it) => (
              <ItemRow key={it.canvasId} item={it} dueLabel={it.dueAt ? countdownLabel(it.dueAt, todayYmd) : ""} />
            ))}
          </div>
        )}
        <Link
          href="/plan"
          className="mt-2 flex items-center justify-center rounded-xl border border-line py-2.5 text-[15px] font-medium text-accent transition hover:bg-surface-soft"
        >
          See your full plan →
        </Link>
      </div>
    </div>
  );
}

// ── Upcoming assessments → a glance at tests/quizzes + a door to /study. ─────────
function UpcomingTestsCard({ data, todayYmd }: { data: CalendarData; todayYmd: string }) {
  const studyBooked = new Set(data.plan.days.flatMap((d) => d.blocks.filter((b) => b.study).map((b) => b.canvasId)));
  const rank = new Map(data.ranked.map((r, i) => [r.canvasId, i] as const));
  const tests = data.items
    .filter((it) => (it.type === "exam" || it.type === "quiz") && it.status === "normal")
    .sort((a, b) => (rank.get(a.canvasId) ?? 1e9) - (rank.get(b.canvasId) ?? 1e9))
    .slice(0, 5);

  return (
    <div className="card p-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold text-ink">Upcoming assessments</h2>
        <Link href="/study" className="text-[15px] font-medium text-accent hover:underline">
          Study →
        </Link>
      </div>
      {tests.length === 0 ? (
        <p className="py-5 text-center text-[15px] text-muted">No tests or quizzes on the horizon.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line-subtle">
          {tests.map((t) => (
            <li key={t.canvasId}>
              <Link href={itemHref(t.canvasId, t.type, t.status)} className="flex items-center justify-between gap-3 rounded-lg py-3 transition hover:bg-surface-soft/60">
                <span className="min-w-0">
                  <span className="block truncate text-[16px] font-medium text-ink">{t.name}</span>
                  <span className="block truncate text-[14px] text-muted">
                    {TYPE_LABEL[t.type]} · {shortCourse(t.courseName)}
                    {t.pointsPossible != null && t.pointsPossible > 0 ? ` · ${t.pointsPossible} pts` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-[14px] font-semibold text-accent">{t.dueAt ? countdownLabel(t.dueAt, todayYmd) : "No date"}</span>
                  {studyBooked.has(t.canvasId) && <span className="block text-[12px] font-medium text-success">Study booked</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Overdue list — opened from the Overdue KPI (it has no card of its own now). ──
// ── Catch up: overdue work, most-important-first, as an action — not just a count.
function CatchUpCard({ items, onOpenAll }: { items: CalendarItem[]; onOpenAll: () => void }) {
  const shown = items.slice(0, 3);
  return (
    <div className="card border-danger/30 p-5 sm:p-6">
      <div className="flex items-baseline justify-between">
        <h2 className="flex items-center gap-2 text-xl font-semibold text-danger">
          <span className="h-2.5 w-2.5 rounded-full bg-danger" aria-hidden /> Catch up
        </h2>
        {items.length > shown.length && (
          <button onClick={onOpenAll} className="text-[15px] font-medium text-danger hover:underline">
            All {items.length} →
          </button>
        )}
      </div>
      <p className="mt-1 text-[14px] text-muted">Overdue, most important first — start at the top.</p>
      <div className="mt-2 space-y-0.5">
        {shown.map((it) => (
          <Link key={it.canvasId} href={itemHref(it.canvasId, it.type, it.status)} className="flex w-full items-center gap-3.5 rounded-xl px-3 py-3 text-left transition hover:bg-surface-soft/60">
            <span className="h-[22px] w-[22px] shrink-0 rounded-full border-2 border-danger/50" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px] font-medium text-ink">{it.name}</span>
              <span className="flex items-center gap-1.5 text-[14px] text-muted">
                <span className="truncate">
                  {TYPE_LABEL[it.type]} · {shortCourse(it.courseName)}
                </span>
                <EffortTag hours={it.estimatedEffortHours} className="shrink-0" />
              </span>
            </span>
            <span className="shrink-0 rounded-full bg-danger-soft px-2.5 py-0.5 text-[12px] font-medium text-danger">Past due</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ── Today's study — the scheduled study sessions, restored to home. ──────────────
function TodayStudyCard({ blocks }: { blocks: { canvasId: number; name: string; hours: number }[] }) {
  return (
    <div className="card p-6">
      <h2 className="text-xl font-semibold text-ink">Today&apos;s study</h2>
      <ul className="mt-2 divide-y divide-line-subtle">
        {blocks.map((b, i) => (
          <li key={`${b.canvasId}-${i}`}>
            <Link href={`/study/${b.canvasId}`} className="flex items-center justify-between gap-3 rounded-lg py-3 transition hover:bg-surface-soft/60">
              <span className="min-w-0">
                <span className="block truncate text-[16px] font-medium text-ink">{b.name}</span>
                <span className="block text-[14px] text-muted">Scheduled study</span>
              </span>
              <span className="shrink-0 text-[14px] font-semibold text-success">{fmtHours(b.hours)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OverdueModal({ atRisk, onClose }: { atRisk: CalendarData["atRisk"]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onClick={onClose} role="dialog" aria-modal="true">
      <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xl font-semibold text-danger">
            <span className="h-2.5 w-2.5 rounded-full bg-danger" aria-hidden /> Overdue ({atRisk.length})
          </h2>
          <button onClick={onClose} aria-label="Close" className="text-[22px] leading-none text-muted transition hover:text-ink">
            ✕
          </button>
        </div>
        <ul className="mt-4 max-h-[60vh] space-y-3 overflow-auto">
          {atRisk.map((a) => (
            <li key={a.canvasId} className="flex items-center justify-between gap-2">
              {a.htmlUrl ? (
                <a href={a.htmlUrl} target="_blank" rel="noreferrer" className="min-w-0 truncate text-[16px] text-ink hover:text-accent">
                  {a.name}
                </a>
              ) : (
                <span className="min-w-0 truncate text-[16px] text-ink">{a.name}</span>
              )}
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${toneSoft.danger}`}>Past due</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ConnectCard() {
  return (
    <div className="card mx-auto max-w-xl p-10 text-center">
      <div className="flex justify-center text-accent">
        <Glyph d={ICON.calendar} size={36} />
      </div>
      <p className="mt-4 text-[17px] font-medium text-ink">Welcome to Navo.</p>
      <p className="mt-1.5 text-[15px] text-muted">Connect your Canvas account and we&apos;ll turn your coursework into a calm, day-by-day plan.</p>
      <Link href="/connections" data-tour="connect-canvas" className="btn-primary mt-5">
        Connect Canvas
      </Link>
    </div>
  );
}
