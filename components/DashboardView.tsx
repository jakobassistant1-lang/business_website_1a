"use client";

// The Dashboard — a calm, wide "command screen". Top: an AI summary of the week,
// then a quiet bar of KPIs (week intensity, overdue → opens the full list) with
// the Timeline/Calendar jumps. Below: ONE card whose flush violet Focus block
// (the #1 task) sits above a 7-day "what's coming up" list; a bare progress ring +
// an Upcoming-assessments card into /study sit in the rail.
//
// Phones (#39, below `md`) get a glance-and-act stack: Focus (compact) with the
// Today list → Today's study → This week (next 3 + "See plan") → Catch-up pill
// (opens a Sheet of the overdue rows) → the AI summary (first bullet + More) →
// Next test, with a small progress ring in the header. Where phone and desktop
// differ, BOTH variants are in the DOM and CSS picks one (`md:hidden` /
// `hidden md:block`), so the server HTML is already the right layout — there is
// no width-dependent render and no swap after hydration. DOM order = the phone's
// visual order (no `order-*`). md+ renders exactly as before.
//
// A row can therefore exist twice (phone list + desktop list). Each copy's Undo
// bar is tagged with its `side`; only the copy on the visible side runs the undo
// clock (UndoToast `clock`), and settling is idempotent anyway (lib/pendingDone).

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAutoSync } from "@/components/useAutoSync";
import { UndoToast } from "@/components/UndoToast";
import { Sheet, useIsPhone } from "@/components/Sheet";
import { applyToggle, allSettled, clearPending, isSettled, mergePending, prunePending, settle, toastMessage, visibleSlice, UNDO_FAILED_MESSAGE, type PendingMap } from "@/lib/pendingDone";
import { ymd, parseYmd, WEEKDAYS, WEEKDAYS_FULL, MONTHS_LONG, countdownLabel } from "@/lib/calendarDates";
import { round1 } from "@/lib/round";
import { toneSoft } from "@/lib/tone";
import { deterministicIntensity, overdueLoad, type Intensity } from "@/lib/intensity";
import { Glyph, ICON, fmtTime, fmtHours, EffortTag, DoneCheck, TAP_PHONE, isUpcomingStudy } from "@/components/calendar/parts";
import type { CalendarData, CalendarItem } from "@/lib/calendarData";
import { itemHref, TYPE_LABEL } from "@/lib/itemType";
import { shortCourse } from "@/lib/courseName";

const fmtLongDate = (d: Date) => `${WEEKDAYS_FULL[d.getDay()]}, ${MONTHS_LONG[d.getMonth()]} ${d.getDate()}`;

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
  const [todayYmd, setTodayYmd] = useState(serverToday);
  const [showOverdue, setShowOverdue] = useState(false);
  const [aiPoints, setAiPoints] = useState<string[]>([]);
  const [aiIntensity, setAiIntensity] = useState<Intensity | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [showCatchUp, setShowCatchUp] = useState(false);

  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
    const t = ymd(new Date());
    if (t !== serverToday) setTodayYmd(t);
  }, [serverToday]);

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

  // Overdue, most-important-first — surfaced as an action, not just a count.
  const overdueItems = liveItems.filter((it) => it.status === "overdue").sort(byRank);
  // The KPI and the modal count the same thing the rail shows, minus rows whose undo
  // window has closed (they're done — they just haven't left the screen yet). Without
  // this a mid-window auto-sync would drop a held row from data.atRisk and the count
  // would disagree with the rail underneath it.
  const overdueCount = overdueItems.filter((it) => !isSettled(pendingDone, it.canvasId)).length;
  const atRiskLive = data.atRisk.filter((a) => !isSettled(pendingDone, a.canvasId));

  // Today's scheduled study sessions (restored to the dashboard).
  const todayStudy = (data.plan.days.find((d) => d.date === todayYmd)?.blocks ?? []).filter((b) => isUpcomingStudy(b, todayYmd));

  // Week intensity — deterministic baseline (instant), upgraded by Gemini when it answers.
  const windowDates = new Set(data.plan.days.map((d) => d.date));
  const dueThisWeek = data.items.filter((it) => it.dueAt && windowDates.has(ymd(new Date(it.dueAt))));
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

  // Phone "This week": the next three by importance that are due in the plan
  // window, after today, and aren't the Focus item (which sits above them).
  const focusId = pickFocus(data, liveItems).focusItem?.canvasId;
  const weekNext = visibleSlice(
    liveItems
      .filter((it) => it.status === "normal" && it.canvasId !== focusId && it.dueAt != null && windowDates.has(ymd(new Date(it.dueAt))) && !isDueToday(it))
      .sort(byRank),
    3,
    undoHandlers.held
  );

  // The catch-up Sheet's Undo bars can't outlive it (their clock unmounts with the
  // sheet, and the hidden desktop card's copies never run one on a phone), so
  // closing it commits any open window: those rows settle as done now.
  const closeCatchUp = () => {
    setShowCatchUp(false);
    for (const it of overdueItems) if (undoHandlers.toast(it.canvasId)) expireDone(it.canvasId);
  };

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex items-start justify-between gap-4 md:block">
        <div className="min-w-0">
          <p className="text-[22px] font-semibold text-ink">
            {greeting}
            {firstName ? `, ${firstName}` : ""}
          </p>
          <p className="mt-0.5 text-[15px] text-muted">{fmtLongDate(today)}</p>
          {syncWarning && (
            <p className="mt-1.5 flex items-center gap-2 text-[13px] text-muted">
              <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-muted/60" />
              {syncWarning}
            </p>
          )}
        </div>
        {/* Phones: today's progress shrinks into the header (the rail's big ring is md+). */}
        {data.connected && (
          <div className="shrink-0 md:hidden">
            <ProgressRing done={dueTodayDone} total={dialTotal} small />
          </div>
        )}
      </div>

      {!data.connected ? (
        <ConnectCard />
      ) : (
        <>
          <div className="hidden md:block">
            <AiSummary points={aiPoints} loading={summaryLoading} />
          </div>

          {/* KPI bar — quiet at-a-glance status against the page. (Phones: the
              rating rides the "This week" card and overdue is the Catch-up pill.) */}
          <div className="mb-7 hidden flex-wrap items-center gap-x-12 gap-y-4 border-b border-line-subtle pb-5 md:flex">
            <div data-tour="dash-week"><IntensityKpi intensity={intensity} /></div>
            <OverdueKpi count={overdueCount} onOpen={() => setShowOverdue(true)} />
          </div>

          {/* DOM order is the phone's reading order; the phone-only cards are
              `md:hidden` and the desktop-only ones `hidden md:block`, so md+ sees
              exactly the old two-column layout. */}
          <div className="flex flex-col gap-6 lg:flex-row">
            <div className="min-w-0 flex-1 space-y-6">
              <div data-tour="dash-focus"><FocusTodayCard data={data} items={liveItems} todayYmd={todayYmd} demo={demo} undo={undoHandlers} /></div>
              {todayStudy.length > 0 && <TodayStudyCard className="md:hidden" blocks={todayStudy} />}
              <ThisWeekCard className="md:hidden" items={weekNext} intensity={intensity} todayYmd={todayYmd} demo={demo} undo={undoHandlers} />
              {overdueCount > 0 && <CatchUpPill className="md:hidden" count={overdueCount} onOpen={() => setShowCatchUp(true)} />}
              {(aiPoints.length > 0 || summaryLoading) && (
                <div className="md:hidden">
                  <AiSummary points={aiPoints} loading={summaryLoading} collapsible />
                </div>
              )}
              {overdueItems.length > 0 && (
                <div className="hidden md:block">
                  <CatchUpCard items={overdueItems} onOpenAll={() => setShowOverdue(true)} demo={demo} undo={undoHandlers} />
                </div>
              )}
            </div>
            <aside className="w-full shrink-0 md:space-y-7 lg:w-96">
              <div data-tour="dash-progress" className="hidden md:block"><ProgressDial done={dueTodayDone} total={dialTotal} /></div>
              {todayStudy.length > 0 && <TodayStudyCard className="hidden md:block" blocks={todayStudy} />}
              <div data-tour="dash-tests"><UpcomingTestsCard data={data} todayYmd={todayYmd} /></div>
            </aside>
          </div>
        </>
      )}

      {showOverdue && <OverdueModal atRisk={atRiskLive} onClose={() => setShowOverdue(false)} />}
      {/* Opened only from the phone-only pill. */}
      <Sheet open={showCatchUp} onClose={closeCatchUp} title={`Catch up (${overdueCount})`}>
        <p className="text-[14px] text-muted">Overdue, most important first — start at the top.</p>
        {overdueItems.length === 0 ? (
          <p className="py-6 text-center text-[15px] text-muted">All caught up.</p>
        ) : (
          <div className="-mx-3 mt-2 space-y-0.5">
            {overdueItems.map((it) => (
              <CatchUpRow key={it.canvasId} item={it} demo={demo} undo={undoHandlers} side="any" />
            ))}
          </div>
        )}
      </Sheet>
    </div>
  );
}

// ── AI summary banner — 2-3 scannable bullets. Fail-open: renders nothing once we
// know there are no points. ─────────────────────────────────────────────────────
// `collapsible` (phones): only the first bullet until "More" is tapped.
function AiSummary({ points, loading, collapsible = false }: { points: string[]; loading: boolean; collapsible?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  if (points.length === 0 && !loading) return null;
  const visible = collapsible && !expanded ? points.slice(0, 1) : points;
  const body =
    points.length === 0 ? (
      <p className="text-[16px] leading-relaxed text-muted">Reading your week…</p>
    ) : (
      <ul className="space-y-1.5 text-[16px] leading-relaxed text-ink">
        {visible.map((p, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="mt-[10px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent/60" aria-hidden />
            <span>{p}</span>
          </li>
        ))}
      </ul>
    );
  return (
    <div className={`${collapsible ? "" : "mb-6 "}flex items-start gap-3 rounded-2xl border border-line-subtle bg-surface-soft/60 p-4`}>
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2z" />
        </svg>
      </span>
      {collapsible ? (
        <div className="min-w-0 flex-1">
          {body}
          {points.length > 1 && (
            <button type="button" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded} className="tap -ml-2 px-2 text-[15px] font-medium text-accent">
              {expanded ? "Less" : "More"}
            </button>
          )}
        </div>
      ) : (
        body
      )}
    </div>
  );
}

// ── KPIs (card-less, quiet) ────────────────────────────────────────────────────
const KPI_LABEL = "text-[12px] font-semibold uppercase tracking-wider text-muted";

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
      <p className="mt-1.5 text-[26px] font-bold leading-none text-ink">{count}</p>
      <span className="mt-1 inline-block text-[13px] font-medium text-accent group-hover:underline">View all ›</span>
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
        <span className={`font-bold leading-none tracking-tight text-ink ${small ? "text-[15px]" : "text-[2.5rem] sm:text-[2.85rem]"}`}>{total > 0 ? `${pct}%` : "—"}</span>
        {!small && <span className="mt-1.5 text-xs font-medium text-muted">{total > 0 ? `${done} of ${total} done` : "Nothing due"}</span>}
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

function ItemRow({ item, dueLabel, demo = false, undo, side }: { item: CalendarItem; dueLabel: string; demo?: boolean; undo: UndoHandlers; side: Side }) {
  const held = undo.held(item.canvasId);
  return (
    <div>
      <Link href={itemHref(item.canvasId, item.type, item.status)} className={`tap flex items-center gap-3.5 rounded-xl px-3 py-3 transition hover:bg-surface-soft/60 ${held ? "opacity-70" : ""}`}>
        <DoneCheck canvasId={item.canvasId} checked={held} disabled={demo} deferRefresh onToggled={undo.onToggled(item)} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[16px] font-medium ${held ? "text-muted line-through" : "text-ink"}`}>{item.name}</span>
          <span className="flex items-center gap-1.5 text-[14px] text-muted">
            <span className="truncate">
              {TYPE_LABEL[item.type]} · {shortCourse(item.courseName)}
            </span>
            <EffortTag hours={item.estimatedEffortHours} className="shrink-0" />
          </span>
        </span>
        <span className={`shrink-0 text-[14px] font-medium ${held ? "text-muted" : "text-ink"}`}>{dueLabel}</span>
      </Link>
      <UndoSlot undo={undo} canvasId={item.canvasId} side={side} />
    </div>
  );
}

// ── Focus + what's next: a flush, rounded-bottom violet Focus block (the #1 task)
// sits edge-to-edge atop a 7-day due list, all in one card. ─────────────────────
/** The Focus item (the #1 forward recommendation) + the rank-ordered active rows it
 *  was picked from. The ONE rule — the Focus card and the phone "This week" list
 *  (which must skip it) both call this. */
function pickFocus(data: CalendarData, items: CalendarItem[]): { focusItem: CalendarItem | undefined; normal: CalendarItem[] } {
  const rank = new Map(data.ranked.map((r, i) => [r.canvasId, i] as const));
  const normal = items
    .filter((it) => it.status === "normal")
    .sort((a, b) => (rank.get(a.canvasId) ?? 1e9) - (rank.get(b.canvasId) ?? 1e9));
  const topRec = data.recommendations[0];
  const fromRec = topRec ? data.items.find((it) => it.canvasId === topRec.canvasId) : undefined;
  // Fall back to the #1 ranked item when there's no forward recommendation, so we
  // never show "all caught up" above a list that still has items.
  return { focusItem: fromRec ?? normal[0], normal };
}

function FocusTodayCard({ data, items, todayYmd, demo = false, undo }: { data: CalendarData; items: CalendarItem[]; todayYmd: string; demo?: boolean; undo: UndoHandlers }) {
  const { focusItem, normal } = pickFocus(data, items);
  const rest = normal.filter((it) => it.canvasId !== focusItem?.canvasId);
  // Beneath the Focus item: the next 3 by importance — OR everything still due
  // TODAY when that's a longer list, so a heavy today never hides behind the cut.
  const dueToday = rest.filter((it) => it.dueAt != null && ymd(new Date(it.dueAt)) === todayYmd);
  // Held rows first, so a refresh mid-window (which drops them from `ranked` and
  // therefore sorts them last) can't push a row and its Undo bar off the cut.
  const heavyToday = dueToday.length > 3;
  const restList = visibleSlice(heavyToday ? dueToday : rest, heavyToday ? dueToday.length : 3, undo.held);
  // Phones: the list is strictly "Today" (everything else due today); the next few
  // beyond today live in the separate "This week" card below.
  const todayList = visibleSlice(dueToday, dueToday.length, undo.held);
  const isToday = !!focusItem?.dueAt && ymd(new Date(focusItem.dueAt)) === todayYmd;
  const caughtUp = data.atRisk.length === 0;
  const href = focusItem ? itemHref(focusItem.canvasId, focusItem.type, focusItem.status) : null;

  return (
    <div className="card overflow-hidden p-0">
      {focusItem && href ? (
        // Phones: compact — smaller padding and title, chips inline with Open, and
        // the rationale (which only restates the chips) dropped. md+ as before.
        <div className="rounded-b-2xl bg-accent px-5 py-5 text-white md:px-8 md:py-7">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-white/80">Focus now</p>
          <Link href={href} className="mt-1.5 block max-w-full text-left">
            <span className="block text-[1.4rem] font-bold leading-[1.12] tracking-tight md:text-[2.15rem]">{focusItem.name}</span>
          </Link>
          <div className="mt-3 flex items-center justify-between gap-3 md:block">
            <div className="flex min-w-0 flex-wrap gap-2">
              {focusChips(focusItem, isToday).map((c, i) => (
                <Chip key={i} text={c} />
              ))}
            </div>
            <p className="mt-3 hidden text-[16px] text-white/90 md:block">{focusRationale(focusItem, isToday)}</p>
            <div className="shrink-0 md:mt-5">
              <Link href={href} className="inline-block rounded-[14px] bg-white px-5 py-3 text-[15px] font-semibold text-accent transition hover:bg-white/90 md:py-2.5">
                Open
              </Link>
            </div>
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
        {/* Phone variant: strictly today's list. */}
        <div className="md:hidden">
          <h2 className="px-3 pb-1 pt-1 text-[12px] font-semibold uppercase tracking-wider text-muted">Today</h2>
          {todayList.length === 0 ? (
            <p className="py-4 text-center text-[15px] text-muted">{isToday ? "Nothing else due today." : "Nothing due today."}</p>
          ) : (
            <div className="space-y-0.5">
              {todayList.map((it) => (
                <ItemRow key={it.canvasId} item={it} dueLabel={it.dueAt ? countdownLabel(it.dueAt, todayYmd) : ""} demo={demo} undo={undo} side="phone" />
              ))}
            </div>
          )}
        </div>
        {/* Desktop variant (md+): the next few by importance, unchanged. */}
        <div className="hidden md:block">
          {restList.length === 0 ? (
            <p className="py-4 text-center text-[15px] text-muted">Nothing else queued up.</p>
          ) : (
            <div className="space-y-0.5">
              {restList.map((it) => (
                <ItemRow key={it.canvasId} item={it} dueLabel={it.dueAt ? countdownLabel(it.dueAt, todayYmd) : ""} demo={demo} undo={undo} side="desktop" />
              ))}
            </div>
          )}
        </div>
        {/* Phones get "See plan →" in the This week card instead. */}
        <Link
          href="/plan"
          className="mt-2 hidden items-center justify-center rounded-xl border border-line py-2.5 text-[15px] font-medium text-accent transition hover:bg-surface-soft md:flex"
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
    .sort((a, b) => (rank.get(a.canvasId) ?? 1e9) - (rank.get(b.canvasId) ?? 1e9));
  const next = tests[0];

  return (
    <div className="card p-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold text-ink">Next test</h2>
        <Link href="/study" className={`inline-flex items-center text-[15px] font-medium text-accent hover:underline md:inline ${TAP_PHONE}`}>
          Study →
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
            <span className="mt-1 block text-[14px] font-semibold text-accent">{next.dueAt ? countdownLabel(next.dueAt, todayYmd) : "No date"}</span>
            {studyBooked.has(next.canvasId) && <span className="mt-0.5 block text-[12px] font-medium text-success">Study booked</span>}
          </Link>
          {tests.length > 1 && (
            <Link href="/study" className={`mt-2 block border-t border-line-subtle pt-3 text-[14px] font-medium text-accent hover:underline ${TAP_PHONE}`}>
              All {tests.length} upcoming tests in Study →
            </Link>
          )}
        </>
      )}
    </div>
  );
}

// ── Overdue list — opened from the Overdue KPI (it has no card of its own now). ──
// ── Catch up: overdue work, most-important-first, as an action — not just a count.
function CatchUpCard({ items, onOpenAll, demo = false, undo }: { items: CalendarItem[]; onOpenAll: () => void; demo?: boolean; undo: UndoHandlers }) {
  const shown = visibleSlice(items, 3, undo.held); // held rows can't fall off the cut
  return (
    <div className="card p-5 sm:p-6">
      <div className="flex items-baseline justify-between">
        <h2 className="flex items-center gap-2 text-xl font-semibold text-ink">
          <span className="h-2.5 w-2.5 rounded-full bg-warning" aria-hidden /> Catch up
        </h2>
        {items.length > shown.length && (
          <button onClick={onOpenAll} className="text-[15px] font-medium text-accent hover:underline">
            All {items.length} →
          </button>
        )}
      </div>
      <p className="mt-1 text-[14px] text-muted">Overdue, most important first — start at the top.</p>
      <div className="mt-2 space-y-0.5">
        {shown.map((it) => (
          <CatchUpRow key={it.canvasId} item={it} demo={demo} undo={undo} side="desktop" />
        ))}
      </div>
    </div>
  );
}

/** One overdue row — shared by the desktop Catch-up card and the phone Sheet. */
function CatchUpRow({ item: it, demo = false, undo, side }: { item: CalendarItem; demo?: boolean; undo: UndoHandlers; side: Side }) {
  const held = undo.held(it.canvasId);
  return (
    <div>
      <Link href={itemHref(it.canvasId, it.type, it.status)} className={`tap flex w-full items-center gap-3.5 rounded-xl px-3 py-3 text-left transition hover:bg-surface-soft/60 ${held ? "opacity-70" : ""}`}>
        <DoneCheck canvasId={it.canvasId} tone="warning" checked={held} disabled={demo} deferRefresh onToggled={undo.onToggled(it)} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[16px] font-medium ${held ? "text-muted line-through" : "text-ink"}`}>{it.name}</span>
          <span className="flex items-center gap-1.5 text-[14px] text-muted">
            <span className="truncate">
              {TYPE_LABEL[it.type]} · {shortCourse(it.courseName)}
            </span>
            <EffortTag hours={it.estimatedEffortHours} className="shrink-0" />
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-warning-soft px-2.5 py-0.5 text-[12px] font-medium text-warning">Past due</span>
      </Link>
      <UndoSlot undo={undo} canvasId={it.canvasId} side={side} />
    </div>
  );
}

// ── Phone only: overdue as one count pill in the thumb zone → the Catch-up Sheet.
function CatchUpPill({ count, onOpen, className = "" }: { count: number; onOpen: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className={`tap flex w-full items-center justify-between gap-3 rounded-2xl border border-line-subtle bg-surface px-4 py-2 text-left ${className}`}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-warning" aria-hidden />
        <span className="text-[16px] font-semibold text-ink">Catch up</span>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${toneSoft.warning}`}>{count} overdue</span>
      </span>
      <span className="shrink-0 text-[15px] font-medium text-accent">Open ›</span>
    </button>
  );
}

// ── Phone only: "This week" collapsed to the next three rows + a door to /plan,
// with the week's Easy/Moderate/Hard rating (the desktop KPI) in its header.
function ThisWeekCard({ items, intensity, todayYmd, demo = false, undo, className = "" }: { items: CalendarItem[]; intensity: Intensity; todayYmd: string; demo?: boolean; undo: UndoHandlers; className?: string }) {
  const cfg = INTENSITY_CFG[intensity];
  return (
    <section className={`card p-3 ${className}`}>
      <div className="flex items-center justify-between gap-3 px-3 pt-1">
        <h2 className="text-[17px] font-semibold text-ink">This week</h2>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${cfg.soft}`}>
          <span className={`h-2 w-2 rounded-full ${cfg.dot}`} aria-hidden />
          {cfg.word}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="py-4 text-center text-[15px] text-muted">Nothing else due this week.</p>
      ) : (
        <div className="mt-1 space-y-0.5">
          {items.map((it) => (
            <ItemRow key={it.canvasId} item={it} dueLabel={it.dueAt ? countdownLabel(it.dueAt, todayYmd) : ""} demo={demo} undo={undo} side="phone" />
          ))}
        </div>
      )}
      <Link href="/plan" className="tap mt-1 flex items-center justify-center rounded-xl text-[15px] font-medium text-accent">
        See plan →
      </Link>
    </section>
  );
}

// ── Today's study — the scheduled study sessions, restored to home. ──────────────
function TodayStudyCard({ blocks, className = "" }: { blocks: { canvasId: number; name: string; hours: number }[]; className?: string }) {
  return (
    <div className={`card p-6 ${className}`}>
      <h2 className="text-xl font-semibold text-ink">Today&apos;s study</h2>
      <ul className="mt-2 divide-y divide-line-subtle">
        {blocks.map((b, i) => (
          <li key={`${b.canvasId}-${i}`}>
            <Link href={`/study/${b.canvasId}`} className="tap flex items-center justify-between gap-3 rounded-lg py-3 transition hover:bg-surface-soft/60">
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
          <h2 className="flex items-center gap-2 text-xl font-semibold text-ink">
            <span className="h-2.5 w-2.5 rounded-full bg-warning" aria-hidden /> Overdue ({atRisk.length})
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
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${toneSoft.warning}`}>Past due</span>
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
      <Link href="/connections" data-tour="connect-canvas" className={`btn-primary mt-5 ${TAP_PHONE}`}>
        Connect Canvas
      </Link>
    </div>
  );
}
