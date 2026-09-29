"use client";

// The "Plan" surface — one home for the student's coursework, viewable three ways:
//   • List — the do-next order (importance rank, NEVER the clock), in five groups:
//     Past due → Do next → Not open yet → No due date → Graded by your teacher (#135). Inside each group the
//     app's importance order; the rank numbers stay GLOBAL, so "#3 sits in Past
//     due" shows at a glance. The violet row is THE Focus item (lib/planFocus —
//     the same rule as the Dashboard's Focus card) wherever it sits, at every width.
//   • Calendar — the same work laid on a day/week/month grid (when is it due).
//   • Timeline — the Gantt of recommended order by course.
// Merges the old Calendar + Timeline pages so the nav stays lean.
//
// Phones (#39): List only. The view switcher is hidden below `md` and the saved
// preference is never applied there (lib/planView.resolvePlanView) — nor
// overwritten, so a laptop still opens the student's chosen view. Until the
// width is known (server render + first client frame) a skeleton stands in, so a
// phone never mounts Calendar/Timeline (and their sync/briefing effects) at all.
//
// Every width: a pinned "Study this week" strip (StudyWeekStrip) sits under the
// header, above whichever view renders.
//
// Dates: every day and due date reads the student's Canvas zone (lib/studentZone)
// — `data.todayYmd` from the loader, `dataZone(data)` for instants — so the
// server render and every browser agree, with no swap after mount.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { shortCourse } from "@/lib/courseName";
import { CalendarView, writeCalendarPlace } from "@/components/CalendarView";
import { TimelineView } from "@/components/TimelineView";
import { StudyWeekStrip } from "@/components/StudyWeekStrip";
import { DueLabel } from "@/components/DueLabel";
import { UndoToast } from "@/components/UndoToast";
import { DoneCheck, EffortTag, Glyph, ICON, PAST_DUE_CHIP, effortHoursText } from "@/components/calendar/parts";
import { applyToggle, allSettled, clearPending, prunePending, settle, toastMessage, UNDO_FAILED_MESSAGE, type PendingMap } from "@/lib/pendingDone";
import { focusOrderOf, hasOpenWindow, orderDuringUndo, planListView, reasonDetail, type PlanGroupKey } from "@/lib/planFocus";
import { dataZone } from "@/lib/studentZone";
import { itemHref, TYPE_LABEL } from "@/lib/itemType";
import { DEFAULT_PLAN_VIEW, isPlanView, resolvePlanView, type PlanViewKey } from "@/lib/planView";
import type { CalendarData, CalendarItem } from "@/lib/calendarData";

export { resolvePlanView };

type View = PlanViewKey;

// Same breakpoint as components/Sheet's useIsPhone (below `md`), but tri-state:
// `null` until the browser has answered, so nothing width-dependent mounts on a guess.
const PHONE_QUERY = "(max-width: 767px)";
function usePhoneKnown(): boolean | null {
  const [phone, setPhone] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const update = () => setPhone(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return phone;
}
const VIEWS: { key: View; label: string }[] = [
  { key: "list", label: "List" },
  { key: "calendar", label: "Calendar" },
  { key: "timeline", label: "Timeline" },
];

export function PlanSurface({
  data,
  todayYmd: pageToday,
  focusOrder,
  demo = false,
  initialView,
}: {
  data: CalendarData;
  todayYmd: string;
  /** THE Focus list's id order (the page runs lib/rankActive.focusSlice; see lib/planFocus). */
  focusOrder?: number[];
  demo?: boolean;
  initialView?: View;
}) {
  // The student's day: the loader's `todayYmd` (live and demo payloads both carry
  // it); the page's `todayYmd` (= dataToday(data)) is only a fallback for a
  // payload without one.
  const todayYmd = data.todayYmd ?? pageToday;
  const zone = dataZone(data);
  const [view, setView] = useState<View>(initialView ?? DEFAULT_PLAN_VIEW); // calendar default; the saved pref (sp_plan_view) overrides it post-mount
  const phone = usePhoneKnown();
  // What actually renders: the demo's explicit view as given (demo sync is
  // inert); otherwise the preference on tablet/desktop, always the List on a
  // phone, and nothing (a skeleton) until the width is known.
  const shown: View | null = initialView ? view : resolvePlanView(view, phone);

  useEffect(() => {
    if (initialView) return; // demo controls the view; ignore the saved pref
    try {
      const saved = localStorage.getItem("sp_plan_view");
      if (isPlanView(saved)) setView(saved);
    } catch {
      /* ignore */
    }
  }, [initialView]);

  function pick(v: View) {
    setView(v);
    // Leaving the Calendar: its ?view=&date= no longer describe the page.
    if (v !== "calendar" && !demo) writeCalendarPlace(null);
    try {
      localStorage.setItem("sp_plan_view", v);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[26px] font-bold tracking-tight text-ink">Plan</h1>
        {/* Hidden below md: phones only get the List, so there's nothing to switch. */}
        <div data-tour="plan-views" role="tablist" aria-label="Plan view" className="hidden gap-1 rounded-lg border border-line-subtle bg-surface-soft p-1 md:flex">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              role="tab"
              aria-selected={v.key === shown}
              onClick={() => pick(v.key)}
              className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition ${v.key === shown ? "bg-accent text-accent-on" : "text-muted hover:bg-surface"}`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <StudyWeekStrip days={data.plan.days} todayYmd={todayYmd} zone={zone} />

      {shown === null && <div role="status" aria-busy="true" aria-label="Loading your plan" className="card h-72 animate-pulse bg-surface-soft" />}
      {shown === "list" && <PlanList data={data} todayYmd={todayYmd} zone={zone} focusOrder={focusOrderOf(data, focusOrder)} demo={demo} />}
      {shown === "calendar" && <CalendarView data={data} todayYmd={todayYmd} demo={demo} defaultView="week" />}
      {shown === "timeline" && <TimelineView data={data} />}
    </div>
  );
}

// ── List = the do-next order, grouped (#135). ─────────────────────────────────────

/** How long a checked-off row stays put with its Undo bar (the Dashboard's window). */
const UNDO_MS = 6000;

/** The undo plumbing a row needs — the Dashboard's pattern (lib/pendingDone). */
type UndoHandlers = {
  held: (canvasId: number) => boolean;
  toast: (canvasId: number) => string | null;
  onToggled: (item: CalendarItem) => (canvasId: number, done: boolean) => void;
  onUndo: (canvasId: number) => void;
  onExpire: (canvasId: number) => void;
};

/** The order a list renders in: the ranking + THE Focus order. */
type Order = { ranked: CalendarData["ranked"]; focusOrder: number[] };

function PlanList({ data, todayYmd, zone, focusOrder, demo = false }: { data: CalendarData; todayYmd: string; zone: string; focusOrder: number[]; demo?: boolean }) {
  // ── "Marked as done" undo window — the Dashboard's pattern. The PATCH goes
  // through at once (DoneCheck, deferRefresh); the row stays in place, struck
  // out, under an Undo bar. The TOAST owns the only clock; when every held row
  // has settled, ONE refresh. What renders is the pure lib/planFocus.planListView
  // (held rows keep their place + group; counts steady; Undo restores), in the
  // order frozen at the first check (orderDuringUndo) while any window is open.
  const router = useRouter();
  const pendingRef = useRef<PendingMap<CalendarItem>>(new Map());
  const [pending, setPending] = useState<PendingMap<CalendarItem>>(pendingRef.current);
  const [frozen, setFrozen] = useState<Order | null>(null);
  const commit = (next: PendingMap<CalendarItem>) => {
    pendingRef.current = next;
    setPending(next);
    if (!hasOpenWindow(next)) setFrozen(null); // every window closed → the live order returns
  };
  const release = (id: number) => commit(clearPending(pendingRef.current, id));
  const expire = (id: number) => {
    const cur = pendingRef.current.get(id);
    if (!cur || cur.settled) return; // gone or already expired — never refresh twice
    const next = settle(pendingRef.current, id);
    commit(next);
    if (allSettled(next)) router.refresh();
  };
  const undo: UndoHandlers = {
    held: (id) => pending.has(id),
    toast: (id) => toastMessage(pending, id),
    onToggled: (item) => (id, done) => {
      if (!done) return release(id); // un-checking inside the window = Undo
      setFrozen((f) => f ?? { ranked: data.ranked, focusOrder });
      commit(applyToggle(pendingRef.current, id, true, item));
    },
    onUndo: (id) => {
      const row = pendingRef.current.get(id);
      release(id); // the row comes back at once; the PATCH catches up
      const failed = () => {
        if (row) commit(applyToggle(pendingRef.current, id, true, row.item, UNDO_FAILED_MESSAGE));
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
    onExpire: expire,
  };
  useEffect(() => {
    const next = prunePending(pendingRef.current, data.items);
    if (next !== pendingRef.current) commit(next);
  }, [data.items]);

  const order = orderDuringUndo(pending, frozen, { ranked: data.ranked, focusOrder });
  // THE Focus row = the ranking module's Focus list (lib/planFocus) — the same
  // item the Dashboard's Focus card shows, past due included.
  const { groups, toDo, pastDue, counts, focusId } = planListView({ items: data.items, ranked: order.ranked, focusOrder: order.focusOrder, pending });

  if (groups.length === 0) {
    return <div className="card p-10 text-center text-[16px] text-muted">All caught up. Nothing on your plate.</div>;
  }

  return (
    <>
      {/* Tour anchor on this short count line (not the full list, which can exceed
          viewport height — that oversized cutout pushed the popover off-screen on
          Back). The popover (side:"bottom") points down at the list. */}
      <p data-tour="plan-list" className="mb-4 text-[14px] text-muted">
        {toDo} to do
        {pastDue > 0 && (
          <>
            {" · "}
            <span className="font-medium text-warning">{pastDue} past due</span>
          </>
        )}
      </p>
      <div className="space-y-7">
        {groups.map((g) => {
          const n = counts[g.key] ?? 0;
          return (
            <section key={g.key} aria-labelledby={`plan-group-${g.key}`}>
              <h2 id={`plan-group-${g.key}`} className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-muted">
                {g.key === "pastDue" && <span className="h-2 w-2 shrink-0 rounded-full bg-warning" aria-hidden />}
                {g.label}
                {/* Read as "Past due, 3 items". */}
                <span className="font-medium tabular-nums" aria-hidden>
                  {n}
                </span>
                <span className="sr-only">, {n === 1 ? "1 item" : `${n} items`}</span>
              </h2>
              {/* One card per row, a small gap between. */}
              <div className="space-y-2">
                {g.rows.map((r) => (
                  <PlanRow key={r.item.canvasId} item={r.item} n={r.rank} group={g.key} todayYmd={todayYmd} zone={zone} focus={r.item.canvasId === focusId} demo={demo} undo={undo} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

// The Focus row wears the dashboard Focus card's violet — the same chip as
// DashboardView's Chip and studyUi's StudyChip. Text is the accent's own
// foreground token at FULL strength (never literal white, never /80): white turns
// dark in dark mode, and a faded foreground or a translucent chip fill drops
// under 4.5:1 in light mode (#141).
const FOCUS_CHIP = "bg-accent-hover text-accent-on ring-1 ring-inset ring-accent-on/25";

/** The row's text link, stretched over the whole card (the Dashboard's pattern):
 *  the card is a `relative` div, the DoneCheck a `relative z-10` sibling BEFORE
 *  the link (keyboard: check, then link), and the link's ::after covers the rest.
 *  No button ever sits inside an anchor. */
const ROW_LINK = "outline-none after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:after:ring-2";
/** Row content that must stay hoverable above the stretched link (EffortTag's tooltip). */
const ABOVE_LINK = "relative z-10";

function PlanRow({
  item,
  n,
  group,
  todayYmd,
  zone,
  focus = false,
  demo = false,
  undo,
}: {
  item: CalendarItem;
  n: number;
  group: PlanGroupKey;
  todayYmd: string;
  zone: string;
  focus?: boolean;
  demo?: boolean;
  undo: UndoHandlers;
}) {
  const pastDue = group === "pastDue";
  const locked = group === "notOpen";
  const teacher = group === "teacher";
  // Check-off, the countdown and the rank emphasis only on work the student can
  // act on — never on a Not-open-yet row or a grade the teacher records.
  const actionable = !locked && !teacher;
  const held = undo.held(item.canvasId);
  // The date is stated ONCE, at the right edge; the reason line keeps the rest
  // (points, share, …). In the teacher group the heading already says who grades it.
  const detail = reasonDetail(item.reason);
  const reason = teacher && detail === "Graded by your teacher" ? null : detail;
  const effort = effortHoursText(item.estimatedEffortHours);
  const sub = focus ? "text-accent-on" : "text-muted";
  return (
    <div>
      <div
        className={`card tap relative isolate flex items-center gap-3 px-3 py-3 transition ${focus ? "border-accent bg-accent text-accent-on" : "hover:bg-surface-soft"} ${held ? "opacity-70" : ""}`}
      >
        {/* The done-glow (globals .animate-done-glow) flashes once as the row is
            checked, under the content (isolate + -z-10) so the card keeps its fill. */}
        {held && <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 rounded-[inherit] animate-done-glow" />}
        {actionable ? (
          <DoneCheck
            className="relative z-10"
            canvasId={item.canvasId}
            itemName={item.name}
            tone={focus ? "onAccent" : pastDue ? "warning" : "default"}
            checked={held}
            disabled={demo}
            deferRefresh
            onToggled={undo.onToggled(item)}
          />
        ) : (
          <span className="h-[22px] w-[22px] shrink-0" aria-hidden />
        )}
        <Link
          href={itemHref(item.canvasId, item.type, item.status)}
          className={`flex min-w-0 flex-1 items-center gap-3 ${ROW_LINK} ${focus ? "focus-visible:after:ring-accent-on" : "focus-visible:after:ring-accent"}`}
        >
          <span className={`w-6 shrink-0 text-center text-[13px] tabular-nums ${focus ? "font-semibold text-accent-on" : actionable ? "font-semibold text-accent" : "font-medium text-muted"}`}>
            <span className="sr-only">Rank </span>
            {n}
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block truncate text-[16px] font-medium ${held ? "line-through" : ""} ${focus ? "text-accent-on" : held ? "text-muted" : "text-ink"}`}>{item.name}</span>
            <span className={`flex items-center gap-1.5 text-[13px] ${sub}`}>
              <span className="truncate">
                {TYPE_LABEL[item.type]} · {shortCourse(item.courseName)}
              </span>
              {/* The item's effort, once — the same number as every other surface. */}
              {focus
                ? effort && (
                    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-medium">
                      <Glyph d={ICON.clock} size={12} />
                      {effort}
                    </span>
                  )
                : <EffortTag hours={item.estimatedEffortHours} className={`shrink-0 ${ABOVE_LINK}`} />}
            </span>
            {reason && <span className={`block truncate text-[13px] ${sub}`}>{reason}</span>}
          </span>
          {teacher ? null : locked ? (
            item.unlockAt ? (
              <span className="shrink-0 text-[14px] font-medium text-muted">
                Opens <DueLabel iso={item.unlockAt} format="short" todayYmd={todayYmd} timeZone={zone} />
              </span>
            ) : null
          ) : pastDue ? (
            <span className={`shrink-0 ${focus ? `rounded-full px-2.5 py-0.5 text-[12px] font-medium ${FOCUS_CHIP}` : PAST_DUE_CHIP}`}>Past due</span>
          ) : item.dueAt ? (
            <DueLabel iso={item.dueAt} format="countdown" todayYmd={todayYmd} timeZone={zone} className={`shrink-0 text-[14px] font-medium ${focus ? "text-accent-on" : held ? "text-muted" : "text-ink"}`} />
          ) : null}
        </Link>
      </div>
      {/* Always mounted and empty when idle — a region that appears with its
          content wouldn't be announced. The toast is a SIBLING of the link. */}
      <div role="status" aria-live="polite">
        {undo.toast(item.canvasId) && (
          <UndoToast message={undo.toast(item.canvasId)!} onUndo={() => undo.onUndo(item.canvasId)} onExpire={() => undo.onExpire(item.canvasId)} durationMs={UNDO_MS} />
        )}
      </div>
    </div>
  );
}
