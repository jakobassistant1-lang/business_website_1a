"use client";

// The Dashboard — a calm, wide "command screen". Top: an AI summary of the week,
// then a quiet KPI bar (the week's rating). Below: ONE card whose flush violet
// Focus block (the #1 task) sits above the next few by importance, then the
// Catch-up card (overdue; "See all" opens the catch-up Sheet); the rail holds a
// bare progress ring (only when something is due today) + the Next-test card.
//
// Phones (#39, below `md`) get a calm glance-and-act stack where the violet Focus
// block is the ONE dominant element: greeting + date → one row with the week's
// difficulty chip and a small progress ring → the Focus card (the same card and
// list as desktop) → Today's study → This week (next 3 not already in the Focus
// card + "See plan"), with a thin Catch-up line just above it when anything is
// overdue (tap = the overdue rows expand in place) → Next test. No AI summary on
// phones. Where phone and desktop
// differ, BOTH variants are in the DOM and CSS picks one (`md:hidden` /
// `hidden md:block`), so the server HTML is already the right layout — there is
// no width-dependent render and no swap after hydration. DOM order = the phone's
// visual order (no `order-*`). md+ renders exactly as before.
//
// A row can therefore exist twice (phone list + desktop list). Each copy's Undo
// bar is tagged with its `side`; only the copy on the visible side runs the undo
// clock (UndoToast `clock`), and settling is idempotent anyway (lib/pendingDone).
//
// Dates: every due date is a <DueLabel> (lib/dueLabel formats), and every "which
// day is this due" test in this file — due today, due this week, the Focus list's
// due-today rule, Today's study — goes through `dashboardDay` (below): UTC before
// mount (so it matches the server's `todayYmd` and the SSR HTML), the viewer's
// zone after. (lib/studyWeek.isStudySessionBlock reads the day in the RUNTIME's
// zone, so the dashboard applies the same rule through `isTodayStudy` instead.)

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useLocalToday } from "@/components/useLocalToday";
import { useMounted } from "@/components/useMounted";
import { DueLabel } from "@/components/DueLabel";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAutoSync } from "@/components/useAutoSync";
import { UndoToast } from "@/components/UndoToast";
import { Sheet, useIsPhone } from "@/components/Sheet";
import { applyToggle, allSettled, clearPending, isSettled, mergePending, prunePending, settle, toastMessage, visibleSlice, UNDO_FAILED_MESSAGE, type PendingMap } from "@/lib/pendingDone";
import { ymdInZone } from "@/lib/calendarDates";
import { round1 } from "@/lib/round";
import { toneSoft } from "@/lib/tone";
import { deterministicIntensity, overdueLoad, type Intensity } from "@/lib/intensity";
import { Glyph, ICON, fmtHours, EffortTag, DoneCheck, TAP_PHONE } from "@/components/calendar/parts";
import type { CalendarData, CalendarItem } from "@/lib/calendarData";
import type { DayBlock } from "@/lib/scheduler";
import { itemHref, TYPE_LABEL } from "@/lib/itemType";
import { shortCourse } from "@/lib/courseName";

/** "Sunday, September 27" for a calendar day. It formats the YMD itself (pinned to
 *  UTC, fixed locale), so the server and the first client render print the same
 *  words; `useLocalToday` then swaps in the viewer's own day after mount. */
const DAY_LINE = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
const fmtDayLine = (dayYmd: string) => DAY_LINE.format(new Date(`${dayYmd}T00:00:00Z`));

/** A row's text link, stretched over the whole row: the row is a `relative` div,
 *  the DoneCheck a `relative z-10` sibling BEFORE the link (so keyboard order is
 *  check, then link), and the link's ::after covers everything else. No button
 *  ever sits inside an anchor. The focus ring is drawn on the ::after so it rings
 *  the full row, as before. */
const ROW_LINK = "outline-none after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-accent";
/** Row content that must stay hoverable above the stretched link (EffortTag's
 *  title tooltip). A click on it still lands inside the link and navigates. */
const ABOVE_LINK = "relative z-10";

// ── The dashboard's day rule (pure, exported for tests) ─────────────────────────
/** The zone the dashboard reads due days in: UTC until mount (the server's
 *  `todayYmd` is a UTC day on Vercel, and the SSR HTML must match hydration),
 *  the viewer's own zone (undefined) after — the same pairing <DueLabel> uses. */
export const dashboardZone = (mounted: boolean): string | undefined => (mounted ? undefined : "UTC");
/** The calendar day ("YYYY-MM-DD") a due instant falls on in `zone`. */
export const dashboardDay = (iso: string, zone: string | undefined): string => ymdInZone(iso, zone);
/** Due on `todayYmd`, read in `zone`. */
export const isDueOn = (it: Pick<CalendarItem, "dueAt">, todayYmd: string, zone: string | undefined): boolean =>
  it.dueAt != null && dashboardDay(it.dueAt, zone) === todayYmd;
/** A real study session for an assessment due today or later — the
 *  lib/studyWeek.isStudySessionBlock rule, read in `zone` instead of the runtime's. */
export const isTodayStudy = (b: Pick<DayBlock, "study" | "hours" | "dueAt">, todayYmd: string, zone: string | undefined): boolean =>
  !!b.study && b.hours > 0 && dashboardDay(b.dueAt, zone) >= todayYmd;

/** How long a checked-off row stays put with its Undo bar. */
const UNDO_MS = 6000;

/** The undo plumbing a dashboard row needs, bundled so rows take one prop.
 *  `held` = the row reads as done (window open OR expired-but-not-yet-gone);
 *  `toast` = the Undo bar's copy while the window is open, else null. */
type UndoHandlers = {
  held: (canvasId: number) => boolean;
  toast: (canvasId: number) => string | null;
  onToggled: (item: CalendarItem) => (canvasId: number, done: boolean) => void;
  onUndo: (canvasId: number) => void;
  onExpire: (canvasId: number) => void;
};

export function DashboardView({ data, todayYmd: serverToday, firstName, demo = false }: { data: CalendarData; todayYmd: string; firstName: string; demo?: boolean }) {
  const [greeting, setGreeting] = useState("Hello"); // neutral on first render → no hydration mismatch
  const todayYmd = useLocalToday(serverToday); // the device's own day (shared with PlanSurface)
  // Due days read in UTC until mount, the viewer's zone after (see dashboardZone).
  // Accepted: when the two readings disagree (a late-evening deadline, or the
  // UTC day already being tomorrow), the ring counts, Today's study and the
  // Focus list can shift ONCE right after mount. That's the correct local
  // answer replacing the server's — never a hydration mismatch.
  const mounted = useMounted();
  const zone = dashboardZone(mounted);
  const dueDay = (iso: string) => dashboardDay(iso, zone);
  const [aiPoints, setAiPoints] = useState<string[]>([]);
  const [aiIntensity, setAiIntensity] = useState<Intensity | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [showCatchUp, setShowCatchUp] = useState(false);

  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
  }, []);

  // Canvas auto-sync: full on mount when ≥10 min stale, quick submission refresh
  // when the tab comes back (the server decides — components/useAutoSync).
  const { warning: syncWarning } = useAutoSync({ connected: data.connected, syncedAt: data.syncedAt, demo });

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
        if (Array.isArray(body.points)) setAiPoints(body.points.filter((x: unknown): x is string => typeof x === "string"));
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

  // ── "Marked as done" undo window ──────────────────────────────────────────────
  // Checking a row's circle PATCHes straight away, but the row stays put for a few
  // seconds under an Undo bar instead of vanishing. The TOAST owns the only clock:
  // it calls onExpire, which settles the row (still struck out, toast gone) and, once
  // every held row has settled, refreshes once. Un-settled snapshots are merged back
  // into the list below, so a refresh from anywhere can't yank a row out mid-window.
  const router = useRouter();
  const pendingRef = useRef<PendingMap<CalendarItem>>(new Map());
  const [pendingDone, setPendingDone] = useState<PendingMap<CalendarItem>>(pendingRef.current);
  // The ref is the handlers' view of the map (they're captured by callbacks); render
  // reads the state value. Both move together here and nowhere else.
  const commitPending = (next: PendingMap<CalendarItem>) => {
    pendingRef.current = next;
    setPendingDone(next);
  };
  /** Undo / un-click — let the row go right now. */
  const releaseDone = (id: number) => commitPending(clearPending(pendingRef.current, id));
  /** The window ran out. Settle (don't delete) so the row keeps reading as done
   *  while OTHER rows are still mid-window, and refresh only once they all have. */
  const expireDone = (id: number) => {
    const cur = pendingRef.current.get(id);
    if (!cur || cur.settled) return; // gone or already expired — never refresh twice
    const next = settle(pendingRef.current, id);
    commitPending(next);
    if (allSettled(next)) router.refresh();
  };
  const undoHandlers: UndoHandlers = {
    held: (id) => pendingDone.has(id),
    toast: (id) => toastMessage(pendingDone, id),
    onToggled: (item) => (id, done) => {
      // Un-checking inside the window is the same thing as pressing Undo — the
      // PATCH that put it back has already gone through in DoneCheck.
      if (!done) return releaseDone(id);
      commitPending(applyToggle(pendingRef.current, id, true, item));
    },
    onUndo: (id) => {
      const row = pendingRef.current.get(id);
      releaseDone(id); // the row comes back immediately; the PATCH catches up
      const failed = () => {
        // Couldn't undo: the item really is done server-side, so put the row back
        // under a fresh window saying so rather than refreshing it out from under
        // the student (which would also fire while other toasts are still open).
        if (row) commitPending(applyToggle(pendingRef.current, id, true, row.item, UNDO_FAILED_MESSAGE));
      };
      fetch("/api/assignment/done", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, done: false }),
      })
        .then((res) => {
          if (!res.ok) failed();
        })
        .catch(failed);
    },
    onExpire: expireDone,
  };
  // After any refresh: forget settled rows the fresh list has dropped. Ones it still
  // carries stay held, so they stay struck rather than flashing back to normal.
  useEffect(() => {
    const next = prunePending(pendingRef.current, data.items);
    if (next !== pendingRef.current) commitPending(next);
  }, [data.items]);

  // The list the rows render from: what the server sent ∪ the rows we're holding.
  const liveItems = mergePending(data.items, pendingDone);

  const isDueToday = (it: CalendarItem) => isDueOn(it, todayYmd, zone);

  // Today's-progress ring counts (today's submitted vs total due today).
  const dueTodayActive = data.items.filter((it) => it.status !== "done" && isDueToday(it)).length;
  const dueTodayDone = data.completed.filter(isDueToday).length;
  const dialTotal = dueTodayActive + dueTodayDone;

  // Do-next ordering — EVERYTHING on the dashboard follows the importance ranking
  // (lib/priority), never the clock. That intelligent order is the product's value;
  // due dates are shown as context, never used as the sort key.
  const rank = new Map(data.ranked.map((r, i) => [r.canvasId, i] as const));
  const byRank = (a: CalendarItem, b: CalendarItem) => (rank.get(a.canvasId) ?? 1e9) - (rank.get(b.canvasId) ?? 1e9);

  // Overdue, most-important-first — surfaced as an action, not just a count.
  const overdueItems = liveItems.filter((it) => it.status === "overdue").sort(byRank);
  // The catch-up count, minus rows whose undo window has closed (they're done —
  // they just haven't left the screen yet). Without this a mid-window auto-sync
  // would drop a held row from data.atRisk and the count would disagree with the
  // rows underneath it.
  const overdueCount = overdueItems.filter((it) => !isSettled(pendingDone, it.canvasId)).length;

  // Today's scheduled study sessions (restored to the dashboard).
  const todayStudy = (data.plan.days.find((d) => d.date === todayYmd)?.blocks ?? []).filter((b) => isTodayStudy(b, todayYmd, zone));

  // Week intensity — deterministic baseline (instant), upgraded by Gemini when it answers.
  const windowDates = new Set(data.plan.days.map((d) => d.date));
  const dueThisWeek = data.items.filter((it) => it.dueAt && windowDates.has(dueDay(it.dueAt)));
  const examQuizWeek = dueThisWeek.filter((it) => it.type === "exam" || it.type === "quiz").length;
  const plannedHours = data.plan.days.reduce((s, d) => s + d.allocated, 0);
  const budgetHours = round1(data.hoursPerDay * data.plan.days.length);
  const workHours = round1(plannedHours + data.overloadHours);
  // Same overdue inputs the server feeds the rating (#62), so the instant baseline
  // and the /api/dashboard-summary verdict can't disagree about a backlog week.
  const baseIntensity = deterministicIntensity({
    dueThisWeek: dueThisWeek.length,
    examQuiz: examQuizWeek,
    workHours,
    budgetHours,
    overloadHours: data.overloadHours,
    ...overdueLoad(data.items),
  });
  const intensity = aiIntensity ?? baseIntensity;

  // The Focus item + the rows beneath it in the same card (one rule, both widths).
  // A held (just-checked-off) row keeps the SPOT it was checked in. `held`
  // promotes rows to the front of a slice, so the Focus card only honours it for
  // rows it was already showing — otherwise checking a "This week" row would
  // pull it up into the Focus card and restart its Undo clock there.
  const focusShown = useRef<Set<number>>(new Set());
  const heldInFocus = (canvasId: number) => undoHandlers.held(canvasId) && focusShown.current.has(canvasId);
  const { focusItem, rest: focusRest } = pickFocus(data, liveItems, isDueToday, heldInFocus);
  const inFocusCard = new Set([focusItem?.canvasId, ...focusRest.map((it) => it.canvasId)]);
  useEffect(() => {
    focusShown.current = new Set([...inFocusCard].filter((id): id is number => id != null));
  });
  // Phone "This week": the next three by importance that are due in the plan
  // window and aren't already in the Focus card above — plus EVERY remaining
  // due-today item, so the "N of M done today" header never counts a row the
  // phone doesn't show.
  const weekPool = liveItems
    .filter((it) => it.status === "normal" && !inFocusCard.has(it.canvasId) && it.dueAt != null && windowDates.has(dueDay(it.dueAt)))
    .sort(byRank);
  const dueTodayLeft = weekPool.filter(isDueToday);
  const weekNext = visibleSlice([...dueTodayLeft, ...weekPool.filter((it) => !isDueToday(it))], Math.max(3, dueTodayLeft.length), undoHandlers.held);

  // The catch-up Sheet's Undo bars can't outlive it (their clock unmounts with the
  // sheet; the card behind it only shows the top three), so closing it commits
  // any open window: those rows settle as done now.
  const closeCatchUp = () => {
    setShowCatchUp(false);
    for (const it of overdueItems) if (undoHandlers.toast(it.canvasId)) expireDone(it.canvasId);
  };

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold text-ink">
            {greeting}
            {firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="mt-0.5 text-[15px] text-muted">{fmtDayLine(todayYmd)}</p>
          {syncWarning && (
            <p className="mt-1.5 flex items-center gap-2 text-[13px] text-muted">
              <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-muted/60" />
              {syncWarning}
            </p>
          )}
        </div>
        {/* Phones: the week's difficulty and today's progress in one quiet row
            (md+ shows them in the KPI row and the rail's big ring). */}
        {data.connected && <PhoneGlance className="mt-4 md:hidden" intensity={intensity} done={dueTodayDone} total={dialTotal} />}
      </div>

      {!data.connected ? (
        <ConnectCard />
      ) : (
        <>
          <div className="hidden md:block">
            <AiSummary points={aiPoints} loading={summaryLoading} />
          </div>

          {/* KPI bar — the week's rating, quiet against the page. (Phones: it sits
              under the greeting. Overdue is counted once, in the Catch-up card.) */}
          <div className="mb-7 hidden flex-wrap items-center gap-x-12 gap-y-4 border-b border-line-subtle pb-5 md:flex">
            <div data-tour="dash-week"><IntensityKpi intensity={intensity} /></div>
          </div>

          {/* DOM order is the phone's reading order; the phone-only cards are
              `md:hidden` and the desktop-only ones `hidden md:block`, so md+ sees
              exactly the old two-column layout. */}
          <div className="flex flex-col gap-6 lg:flex-row">
            <div className="min-w-0 flex-1 space-y-6">
              <div data-tour="dash-focus"><FocusTodayCard data={data} focusItem={focusItem} rest={focusRest} todayYmd={todayYmd} demo={demo} undo={undoHandlers} /></div>
              {todayStudy.length > 0 && <TodayStudyCard className="md:hidden" blocks={todayStudy} />}
              {overdueCount > 0 && <CatchUpEntry className="md:hidden" items={overdueItems} count={overdueCount} demo={demo} undo={undoHandlers} />}
              <ThisWeekCard className="md:hidden" items={weekNext} todayYmd={todayYmd} demo={demo} undo={undoHandlers} />
              {overdueItems.length > 0 && (
                <div className="hidden md:block">
                  <CatchUpCard items={overdueItems} onOpenAll={() => setShowCatchUp(true)} demo={demo} undo={undoHandlers} />
                </div>
              )}
            </div>
            <aside className="w-full shrink-0 md:space-y-7 lg:w-96">
              {/* Only when something is due today — an empty ring says nothing. */}
              {dialTotal > 0 && (
                <div data-tour="dash-progress" className="hidden md:block"><ProgressDial done={dueTodayDone} total={dialTotal} /></div>
              )}
              {todayStudy.length > 0 && <TodayStudyCard className="hidden md:block" blocks={todayStudy} />}
              <div data-tour="dash-tests"><UpcomingTestsCard data={data} todayYmd={todayYmd} /></div>
            </aside>
          </div>
        </>
      )}

      {/* Opened from the desktop Catch-up card's "See all". (Phones expand the
          same rows in place from the Catch-up line.) */}
      <Sheet open={showCatchUp} onClose={closeCatchUp} title={`Catch up (${overdueCount})`}>
        <CatchUpList items={overdueItems} side="any" undo={undoHandlers} demo={demo} />
      </Sheet>
    </div>
  );
}

// ── AI summary banner — 2-3 scannable bullets. Fail-open: renders nothing once we
// know there are no points. md+ only (phones drop it for a calmer screen). ─────
function AiSummary({ points, loading }: { points: string[]; loading: boolean }) {
  if (points.length === 0 && !loading) return null;
  const body =
    points.length === 0 ? (
      <p className="text-[16px] leading-relaxed text-muted">Reading your week…</p>
    ) : (
      <ul className="space-y-1.5 text-[16px] leading-relaxed text-ink">
        {points.map((p, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="mt-[10px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent/60" aria-hidden />
            <span>{p}</span>
          </li>
        ))}
      </ul>
    );
  return (
    <div className="mb-6 flex items-start gap-3 rounded-2xl border border-line-subtle bg-surface-soft/60 p-4">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2z" />
        </svg>
      </span>
      {body}
    </div>
  );
}

// ── KPIs (card-less, quiet) ────────────────────────────────────────────────────
const KPI_LABEL = "text-[12px] font-semibold uppercase tracking-wider text-muted";
/** A shared card's h2 on phones: the quiet small-caps label, so nothing competes
 *  with the Focus card. (md+ keeps each card's own heading.) */
const PHONE_H2 = "max-md:text-[12px] max-md:uppercase max-md:leading-normal max-md:tracking-wider max-md:text-muted";

const INTENSITY_CFG = {
  easy: { word: "Easy", soft: toneSoft.success, dot: "bg-success" },
  moderate: { word: "Moderate", soft: toneSoft.warning, dot: "bg-warning" },
  hard: { word: "Hard", soft: toneSoft.danger, dot: "bg-danger" },
} as const;

function IntensityKpi({ intensity }: { intensity: Intensity }) {
  const cfg = INTENSITY_CFG[intensity];
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
function ProgressRing({ done, total, small = false }: { done: number; total: number; small?: boolean }) {
  const ratio = total > 0 ? Math.min(1, done / total) : 0;
  const pct = Math.round(ratio * 100);
  const shades = ["rgb(var(--accent) / 0.40)", "rgb(var(--accent) / 0.62)", "rgb(var(--accent) / 0.82)", "rgb(var(--accent) / 1)"];
  const cx = 60;
  const cy = 60;
  const r = 52;
  const sw = 13;
  return (
    <div className={`relative shrink-0 ${small ? "h-16 w-16" : "h-32 w-32 sm:h-36 sm:w-36"}`}>
      <svg viewBox="0 0 120 120" className="h-full w-full" role="img" aria-label={total > 0 ? `${pct}% of today’s work done` : "Nothing due today"}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgb(var(--accent) / 0.12)" strokeWidth={sw} />
        {[0, 1, 2, 3].map((i) => {
          const start = i / 4;
          if (ratio <= start) return null;
          const end = Math.min((i + 1) / 4, ratio);
          return <path key={i} d={ringArc(cx, cy, r, i === 0 ? 0 : start - 0.006, end)} fill="none" stroke={shades[i]} strokeWidth={sw} strokeLinecap="butt" />;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-bold leading-none tracking-tight text-ink ${small ? "text-[15px]" : "text-[2.5rem] sm:text-[2.85rem]"}`}>{total > 0 ? `${pct}%` : "—"}</span>
        {!small && <span className="mt-1.5 text-xs font-medium text-muted">{total > 0 ? `${done} of ${total} done` : "Nothing due"}</span>}
      </div>
    </div>
  );
}

function ProgressDial({ done, total }: { done: number; total: number }) {
  return (
    <div>
      <p className={`mb-2 ${KPI_LABEL}`}>Today’s progress</p>
      <div className="flex justify-center">
        <ProgressRing done={done} total={total} />
      </div>
    </div>
  );
}

// ── Phones only: the week's Easy/Moderate/Hard rating and today's progress side
// by side under the greeting. Deliberately quiet (a neutral chip with the tone
// dot, not a tinted fill) so the Focus card stays the one loud thing.
function PhoneGlance({ intensity, done, total, className = "" }: { intensity: Intensity; done: number; total: number; className?: string }) {
  const cfg = INTENSITY_CFG[intensity];
  return (
    <div className={`flex items-center justify-between gap-4 ${className}`}>
      <span className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-line-subtle bg-surface px-3 py-1.5 text-[14px] font-medium text-ink">
        <span className={`h-2 w-2 shrink-0 rounded-full ${cfg.dot}`} aria-hidden />
        {cfg.word} week
      </span>
      <div className="flex min-w-0 items-center gap-3">
        <span className="truncate text-[13px] text-muted">{total > 0 ? `${done} of ${total} done today` : "Nothing due today"}</span>
        <ProgressRing done={done} total={total} small />
      </div>
    </div>
  );
}

// A reason-chip on the violet Focus block. Text on `bg-accent` is always the
// `accent-on` token (white in light mode, ink in dark — white on the lighter
// dark-mode violet is only 3.5:1).
function Chip({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-accent-on/15 px-2.5 py-1 text-xs font-medium text-accent-on ring-1 ring-inset ring-accent-on/25">{children}</span>;
}

// A held (just-checked-off) row keeps its place but reads as finished, with the
// Undo bar rendered as a SIBLING below the <Link> so its button is never a click
// inside the row's navigation target. The live region is always mounted and empty
// when idle — a region that appears with its content wouldn't be announced.
//
// `side` says which layout this copy of the row lives in (#39): only the copy on
// the side currently shown runs the undo clock; the other is a passive mirror.
// (useIsPhone here decides behaviour only — never what renders.)
type Side = "phone" | "desktop" | "any";
function UndoSlot({ undo, canvasId, side }: { undo: UndoHandlers; canvasId: number; side: Side }) {
  const message = undo.toast(canvasId);
  const phone = useIsPhone();
  const clock = side === "any" || (side === "phone") === phone;
  return (
    <div role="status" aria-live="polite">
      {message && <UndoToast message={message} onUndo={() => undo.onUndo(canvasId)} onExpire={() => undo.onExpire(canvasId)} durationMs={UNDO_MS} clock={clock} />}
    </div>
  );
}

function ItemRow({ item, todayYmd, demo = false, undo, side }: { item: CalendarItem; todayYmd: string; demo?: boolean; undo: UndoHandlers; side: Side }) {
  const held = undo.held(item.canvasId);
  return (
    <div>
      <div className={`tap relative flex items-center gap-3.5 rounded-xl px-3 py-3 transition hover:bg-surface-soft/60 ${held ? "opacity-70" : ""}`}>
        <DoneCheck className="relative z-10" canvasId={item.canvasId} checked={held} disabled={demo} deferRefresh onToggled={undo.onToggled(item)} />
        <Link href={itemHref(item.canvasId, item.type, item.status)} className={`flex min-w-0 flex-1 items-center gap-3.5 ${ROW_LINK}`}>
          <span className="min-w-0 flex-1">
            <span className={`block truncate text-[16px] font-medium ${held ? "text-muted line-through" : "text-ink"}`}>{item.name}</span>
            <span className="flex items-center gap-1.5 text-[14px] text-muted">
              <span className="truncate">
                {TYPE_LABEL[item.type]} · {shortCourse(item.courseName)}
              </span>
              <EffortTag hours={item.estimatedEffortHours} className={`shrink-0 ${ABOVE_LINK}`} />
            </span>
          </span>
          <DueLabel iso={item.dueAt} format="countdown" todayYmd={todayYmd} className={`shrink-0 text-[14px] font-medium ${held ? "text-muted" : "text-ink"}`} />
        </Link>
      </div>
      <UndoSlot undo={undo} canvasId={item.canvasId} side={side} />
    </div>
  );
}

// ── Focus + what's next: a flush, rounded-bottom violet Focus block (the #1 task)
// sits edge-to-edge atop a 7-day due list, all in one card. ─────────────────────
/** The Focus item (the #1 forward recommendation) + the rows listed beneath it in
 *  the same card. The ONE rule — the Focus card renders it and the phone "This
 *  week" list skips everything in it. */
export function pickFocus(data: CalendarData, items: CalendarItem[], isDueToday: (it: CalendarItem) => boolean, held: (canvasId: number) => boolean): { focusItem: CalendarItem | undefined; rest: CalendarItem[] } {
  const rank = new Map(data.ranked.map((r, i) => [r.canvasId, i] as const));
  const normal = items
    .filter((it) => it.status === "normal")
    .sort((a, b) => (rank.get(a.canvasId) ?? 1e9) - (rank.get(b.canvasId) ?? 1e9));
  const topRec = data.recommendations[0];
  const fromRec = topRec ? data.items.find((it) => it.canvasId === topRec.canvasId) : undefined;
  // Fall back to the #1 ranked item when there's no forward recommendation, so we
  // never show "all caught up" above a list that still has items.
  const focusItem = fromRec ?? normal[0];
  const others = normal.filter((it) => it.canvasId !== focusItem?.canvasId);
  // Beneath the Focus item: the next 3 by importance — OR everything still due
  // TODAY when that's a longer list, so a heavy today never hides behind the cut.
  const dueToday = others.filter(isDueToday);
  // Held rows first, so a refresh mid-window (which drops them from `ranked` and
  // therefore sorts them last) can't push a row and its Undo bar off the cut.
  const heavyToday = dueToday.length > 3;
  return { focusItem, rest: visibleSlice(heavyToday ? dueToday : others, heavyToday ? dueToday.length : 3, held) };
}

function FocusTodayCard({ data, focusItem, rest, todayYmd, demo = false, undo }: { data: CalendarData; focusItem: CalendarItem | undefined; rest: CalendarItem[]; todayYmd: string; demo?: boolean; undo: UndoHandlers }) {
  const caughtUp = data.atRisk.length === 0;
  const href = focusItem ? itemHref(focusItem.canvasId, focusItem.type, focusItem.status) : null;

  return (
    <div className="card overflow-hidden p-0">
      {focusItem && href ? (
        // Phones: compact — smaller padding and title, chips inline with Open.
        // No rationale line at any width: the chips already say why.
        <div className="rounded-b-2xl bg-accent px-5 py-5 text-accent-on md:px-8 md:py-7">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-accent-on/80">Focus now</p>
          <Link href={href} className="mt-1.5 block max-w-full text-left">
            <span className="block text-[1.4rem] font-bold leading-[1.12] tracking-tight md:text-[2.15rem]">{focusItem.name}</span>
          </Link>
          <div className="mt-3 flex items-center justify-between gap-3 md:block">
            <div className="flex min-w-0 flex-wrap gap-2">
              {focusItem.dueAt && (
                <Chip>
                  <DueLabel iso={focusItem.dueAt} format="chip" todayYmd={todayYmd} />
                </Chip>
              )}
              {focusItem.pointsPossible != null && focusItem.pointsPossible > 0 && <Chip>{focusItem.pointsPossible} pts</Chip>}
            </div>
            <div className="shrink-0 md:mt-5">
              <Link href={href} className="inline-block rounded-[14px] bg-accent-on px-5 py-3 text-[15px] font-semibold text-accent transition hover:bg-accent-on/90 md:py-2.5">
                Open<span className="sr-only"> {focusItem.name}</span>
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-b-2xl bg-surface-soft/70 px-6 py-8 text-center">
          <div className="flex justify-center text-success">
            <Glyph d={ICON.check} size={30} />
          </div>
          <p className="mt-2 text-xl font-semibold text-ink">{caughtUp ? "You’re all caught up." : "Nothing new queued up."}</p>
          <p className="mx-auto mt-1 max-w-md text-[15px] text-muted">
            {caughtUp ? "Nothing’s due and nothing’s overdue — enjoy the breathing room." : "Your upcoming work is clear; chip away at the overdue items when you’re ready."}
          </p>
        </div>
      )}

      <div className="p-3 sm:p-4">
        {/* The next few by importance — the SAME list at every width, directly
            under the violet block in the same card. Its rows exist once (the
            phone "This week" card skips them), so they always run their clock. */}
        {rest.length === 0 ? (
          <p className="py-4 text-center text-[15px] text-muted">Nothing else queued up.</p>
        ) : (
          <div className="space-y-0.5">
            {rest.map((it) => (
              <ItemRow key={it.canvasId} item={it} todayYmd={todayYmd} demo={demo} undo={undo} side="any" />
            ))}
          </div>
        )}
        {/* Phones get "See plan" in the This week card instead. */}
        <Link
          href="/plan"
          className="mt-2 hidden items-center justify-center rounded-xl border border-line py-2.5 text-[15px] font-medium text-accent transition hover:bg-surface-soft md:flex"
        >
          See your full plan
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
    .sort((a, b) => (rank.get(a.canvasId) ?? 1e9) - (rank.get(b.canvasId) ?? 1e9));
  const next = tests[0];

  return (
    <div className="card p-6 max-md:p-4">
      <div className="flex items-baseline justify-between">
        <h2 className={`text-xl font-semibold text-ink ${PHONE_H2}`}>Next test</h2>
        <Link href="/study" className={`inline-flex items-center text-[15px] font-medium text-accent hover:underline md:inline ${TAP_PHONE}`}>
          Study
        </Link>
      </div>
      {!next ? (
        <p className="py-5 text-center text-[15px] text-muted">No tests or quizzes on the horizon.</p>
      ) : (
        <>
          <Link href={itemHref(next.canvasId, next.type, next.status)} className="mt-2 block rounded-lg py-2 transition hover:bg-surface-soft/60">
            <span className="block truncate text-[16px] font-medium text-ink">{next.name}</span>
            <span className="block truncate text-[14px] text-muted">
              {TYPE_LABEL[next.type]} · {shortCourse(next.courseName)}
              {next.pointsPossible != null && next.pointsPossible > 0 ? ` · ${next.pointsPossible} pts` : ""}
            </span>
            <DueLabel iso={next.dueAt} format="countdown" todayYmd={todayYmd} empty="No date" className="mt-1 block text-[14px] font-semibold text-accent max-md:font-medium max-md:text-muted" />
            {studyBooked.has(next.canvasId) && <span className="mt-0.5 block text-[12px] font-medium text-success">Study booked</span>}
          </Link>
          {tests.length > 1 && (
            <Link href="/study" className={`mt-2 block border-t border-line-subtle pt-3 text-[14px] font-medium text-accent hover:underline ${TAP_PHONE}`}>
              All {tests.length} upcoming tests in Study
            </Link>
          )}
        </>
      )}
    </div>
  );
}

// ── Catch up (md+): overdue work, most-important-first, as an action — the ONE
// place desktop counts it. "See all" opens the catch-up Sheet.
function CatchUpCard({ items, onOpenAll, demo = false, undo }: { items: CalendarItem[]; onOpenAll: () => void; demo?: boolean; undo: UndoHandlers }) {
  const shown = visibleSlice(items, 3, undo.held); // held rows can't fall off the cut
  return (
    <div className="card p-5 sm:p-6">
      <div className="flex items-baseline justify-between">
        <h2 className="flex items-center gap-2 text-xl font-semibold text-ink">
          <span className="h-2.5 w-2.5 rounded-full bg-warning" aria-hidden /> Catch up
        </h2>
        {items.length > shown.length && (
          <button type="button" onClick={onOpenAll} aria-haspopup="dialog" className="text-[15px] font-medium text-accent hover:underline">
            See all {items.length}
          </button>
        )}
      </div>
      <CatchUpList className="mt-1" items={shown} side="desktop" undo={undo} demo={demo} />
    </div>
  );
}

/** THE overdue list — one subtitle + the rows — rendered by all three catch-up
 *  surfaces (the desktop card, its Sheet, the phone line's fold-out). The rows
 *  hang 12px into the gutter so their text lines up with the subtitle. */
function CatchUpList({ items, side, undo, demo = false, className = "" }: { items: CalendarItem[]; side: Side; undo: UndoHandlers; demo?: boolean; className?: string }) {
  return (
    <div className={className}>
      <p className="text-[14px] text-muted">Overdue, most important first — start at the top.</p>
      {items.length === 0 ? (
        <p className="py-6 text-center text-[15px] text-muted">All caught up.</p>
      ) : (
        <div className="-mx-3 mt-2 space-y-0.5">
          {items.map((it) => (
            <CatchUpRow key={it.canvasId} item={it} demo={demo} undo={undo} side={side} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One overdue row inside CatchUpList. Same check-beside-link row as ItemRow. */
function CatchUpRow({ item: it, demo = false, undo, side }: { item: CalendarItem; demo?: boolean; undo: UndoHandlers; side: Side }) {
  const held = undo.held(it.canvasId);
  return (
    <div>
      <div className={`tap relative flex w-full items-center gap-3.5 rounded-xl px-3 py-3 text-left transition hover:bg-surface-soft/60 ${held ? "opacity-70" : ""}`}>
        <DoneCheck className="relative z-10" canvasId={it.canvasId} tone="warning" checked={held} disabled={demo} deferRefresh onToggled={undo.onToggled(it)} />
        <Link href={itemHref(it.canvasId, it.type, it.status)} className={`flex min-w-0 flex-1 items-center gap-3.5 ${ROW_LINK}`}>
          <span className="min-w-0 flex-1">
            <span className={`block truncate text-[16px] font-medium ${held ? "text-muted line-through" : "text-ink"}`}>{it.name}</span>
            <span className="flex items-center gap-1.5 text-[14px] text-muted">
              <span className="truncate">
                {TYPE_LABEL[it.type]} · {shortCourse(it.courseName)}
              </span>
              <EffortTag hours={it.estimatedEffortHours} className={`shrink-0 ${ABOVE_LINK}`} />
            </span>
          </span>
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[12px] font-medium ${toneSoft.warning}`}>Past due</span>
        </Link>
      </div>
      <UndoSlot undo={undo} canvasId={it.canvasId} side={side} />
    </div>
  );
}

// ── Phone only: overdue as ONE thin line just above "This week" — a warning-tone
// mark, "N overdue · Catch up", a down chevron. Tapping it expands the overdue
// rows in place (an accordion, not a sheet); tapping again folds them away. The
// parent renders nothing at zero. The rows stay mounted while folded (inert, so
// they're out of the tab order and the accessibility tree). Accepted: folding
// the list while an Undo countdown runs lets it finish — the row settles as done,
// the same end state as closing the desktop Sheet.
const CHEV_DOWN = "M6 9l6 6 6-6";
function CatchUpEntry({ items, count, demo = false, undo, className = "" }: { items: CalendarItem[]; count: number; demo?: boolean; undo: UndoHandlers; className?: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={`card overflow-hidden p-0 ${className}`}>
      <h2 id={headingId} className="sr-only">
        Catch up
      </h2>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className={`tap flex w-full items-center gap-2.5 px-4 text-left text-[15px] ${toneSoft.warning}`}
      >
        <Glyph d={ICON.alert} size={16} />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-semibold">{count} overdue</span> · Catch up
        </span>
        <span className={`shrink-0 motion-safe:transition-transform motion-safe:duration-200 ${open ? "rotate-180" : ""}`}>
          <Glyph d={CHEV_DOWN} size={18} />
        </span>
      </button>
      <div
        id={panelId}
        inert={!open}
        className={`grid ease-out motion-safe:transition-[grid-template-rows] motion-safe:duration-200 ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="min-h-0 overflow-hidden">
          <CatchUpList className="px-5 pb-2 pt-3" items={items} side="phone" undo={undo} demo={demo} />
        </div>
      </div>
    </section>
  );
}

// ── Phone only: "This week" collapsed to the next three rows (skipping what the
// Focus card already lists) + a door to /plan.
function ThisWeekCard({ items, todayYmd, demo = false, undo, className = "" }: { items: CalendarItem[]; todayYmd: string; demo?: boolean; undo: UndoHandlers; className?: string }) {
  return (
    <section className={`card p-3 ${className}`}>
      <h2 className={`px-3 pt-1 ${KPI_LABEL}`}>This week</h2>
      {items.length === 0 ? (
        <p className="py-4 text-center text-[15px] text-muted">Nothing else due this week.</p>
      ) : (
        <div className="mt-1 space-y-0.5">
          {items.map((it) => (
            <ItemRow key={it.canvasId} item={it} todayYmd={todayYmd} demo={demo} undo={undo} side="phone" />
          ))}
        </div>
      )}
      <Link href="/plan" className="tap mt-1 flex items-center justify-center rounded-xl text-[15px] font-medium text-accent">
        See plan
      </Link>
    </section>
  );
}

// ── Today's study — the scheduled study sessions, restored to home. ──────────────
function TodayStudyCard({ blocks, className = "" }: { blocks: { canvasId: number; name: string; hours: number }[]; className?: string }) {
  return (
    <div className={`card p-6 max-md:p-4 ${className}`}>
      <h2 className={`text-xl font-semibold text-ink ${PHONE_H2}`}>Today’s study</h2>
      <ul className="mt-2 divide-y divide-line-subtle">
        {blocks.map((b, i) => (
          <li key={`${b.canvasId}-${i}`}>
            <Link href={`/study/${b.canvasId}`} className="tap flex items-center justify-between gap-3 rounded-lg py-3 transition hover:bg-surface-soft/60">
              <span className="min-w-0">
                <span className="block truncate text-[16px] font-medium text-ink">{b.name}</span>
                <span className="block text-[14px] text-muted">Scheduled study</span>
              </span>
              <span className="shrink-0 text-[14px] font-semibold text-success max-md:font-medium max-md:text-muted">{fmtHours(b.hours)}</span>
            </Link>
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
      <p className="mt-4 text-[17px] font-medium text-ink">Welcome to Navo.</p>
      <p className="mt-1.5 text-[15px] text-muted">Connect your Canvas account and we’ll turn your coursework into a calm, day-by-day plan.</p>
      <Link href="/connections" data-tour="connect-canvas" className={`btn-primary mt-5 ${TAP_PHONE}`}>
        Connect Canvas
      </Link>
    </div>
  );
}
