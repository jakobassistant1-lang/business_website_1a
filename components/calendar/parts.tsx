"use client";

// Shared building blocks for the Calendar + Timeline views. Everything here is
// token-based (the one exception is the per-course data-viz color from
// lib/courseColor). The AI study-coach summary fails open by design.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { courseColor } from "@/lib/courseColor";
import { toneSoft } from "@/lib/tone";
import { isStudyType, type ItemType } from "@/lib/itemType";
import type { CalendarItem } from "@/lib/calendarData";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { AtRiskItem } from "@/lib/scheduler";
import type { ScoredAssignment } from "@/lib/priority";

export const ICON = {
  alert: "M12 9v4M12 17h.01M10.3 4.3 2.7 18a1.5 1.5 0 0 0 1.3 2.2h16a1.5 1.5 0 0 0 1.3-2.2L13.7 4.3a1.5 1.5 0 0 0-2.6 0Z",
  list: "M8 6h12M8 12h12M8 18h12M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  check: "M20 6 9 17l-5-5",
  calendar: "M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z",
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  chevL: "M15 6l-6 6 6 6",
  chevR: "M9 6l6 6-6 6",
  spark: "M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4L12 3Z",
  doc: "M14 3v5h5M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM9 13h6M9 17h4",
  quiz: "M9 12l2 2 4-4M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  chat: "M21 12a8 8 0 0 1-11.5 7.2L3 21l1.8-6.5A8 8 0 1 1 21 12Z",
  inbox: "M3 12h5l2 3h4l2-3h5M5 5h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z",
  x: "M6 6l12 12M18 6 6 18",
};

export function Glyph({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
      <path d={d} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CourseDot({ name }: { name: string }) {
  return <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: courseColor(name) }} aria-hidden />;
}

function typeGlyph(type: ItemType): string {
  return type === "quiz" ? ICON.quiz : type === "other" ? ICON.chat : ICON.doc;
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { hour: "numeric", minute: "2-digit" });
}
export function fmtDueLong(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
/** Hours → friendly label: sub-hour shows minutes (so the 20-min study floor
 *  reads as "20m"), otherwise "Nh". Rounds minutes to the nearest 5. */
export function fmtHours(h: number): string {
  if (h <= 0) return "0m";
  const mins = Math.round((h * 60) / 5) * 5;
  return mins < 60 ? `${mins}m` : `${Math.round(h * 10) / 10}h`;
}
export function effortText(item: CalendarItem): string | null {
  if (item.estimatedEffortHours != null && item.estimatedEffortHours > 0) {
    const h = Math.round(item.estimatedEffortHours * 10) / 10;
    return `~${h}h${item.effortBucket ? ` (${item.effortBucket})` : ""}`;
  }
  return item.effortBucket;
}

type StatusMeta = { pill: { text: string; cls: string } | null; border: string; muted: boolean; danger: boolean };
function statusMeta(item: CalendarItem): StatusMeta {
  if (item.status === "done") return { pill: { text: "Done", cls: toneSoft.success }, border: "border-line-subtle", muted: true, danger: false };
  if (item.status === "overdue") return { pill: { text: "Past due", cls: toneSoft.danger }, border: "border-danger/40 bg-danger-soft/40", muted: false, danger: true };
  return { pill: null, border: "border-line-subtle", muted: false, danger: false };
}

/** The coursework atom rendered in every view. A button → opens ItemDetail. */
export function ItemPill({ item, onSelect, showTime = true }: { item: CalendarItem; onSelect: (it: CalendarItem) => void; showTime?: boolean }) {
  const s = statusMeta(item);
  const glyph = s.danger ? ICON.alert : typeGlyph(item.type);
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      title={`${item.courseName} · ${item.name}`}
      aria-label={`${item.name}, ${item.courseName}${s.pill ? `, ${s.pill.text}` : ""}`}
      className={`flex w-full items-stretch gap-1.5 rounded-md border bg-surface px-1.5 py-1 text-left transition hover:shadow-sm ${s.border} ${s.muted ? "opacity-60" : ""}`}
    >
      <span className="w-1 shrink-0 rounded-full" style={{ background: courseColor(item.courseName) }} aria-hidden />
      <span className={`mt-px shrink-0 ${s.danger ? "text-danger" : "text-muted"}`}>
        <Glyph d={glyph} size={12} />
      </span>
      <span className={`min-w-0 flex-1 truncate text-xs ${s.muted ? "text-muted line-through" : "text-ink"}`}>{item.name}</span>
      {s.pill ? (
        <span className={`shrink-0 self-center rounded-full px-1.5 text-[10px] font-medium ${s.pill.cls}`}>{s.pill.text}</span>
      ) : item.dueAt && showTime ? (
        <span className="shrink-0 self-center text-[10px] text-muted">{fmtTime(item.dueAt)}</span>
      ) : null}
    </button>
  );
}

/** A calendar "busy" block — visually a different species from coursework
 *  (dashed border, no course rail, muted/italic) so it never reads as homework. */
export function BusyRow({ ev }: { ev: CalendarEvent }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-dashed border-line bg-surface-soft px-1.5 py-1 text-xs text-faint">
      <Glyph d={ICON.calendar} size={12} />
      <span className="min-w-0 flex-1 truncate italic">{ev.title || "Busy"}</span>
      {!ev.allDay && <span className="shrink-0">{fmtTime(ev.startTime)}</span>}
    </div>
  );
}

/** Click-to-open detail for a coursework item. Esc / backdrop closes. Shows a
 *  brief Gemini description (the stored AI summary, or one fetched on open). */
export function ItemDetail({ item, onClose }: { item: CalendarItem; onClose: () => void }) {
  const [desc, setDesc] = useState<string | null>(item.summary ?? null);
  const [descLoading, setDescLoading] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    if (item.summary) {
      setDesc(item.summary);
      return;
    }
    let cancelled = false;
    setDesc(null);
    setDescLoading(true);
    fetch(`/api/assignment/describe?id=${item.canvasId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => !cancelled && setDesc(typeof b?.text === "string" ? b.text : null))
      .catch(() => !cancelled && setDesc(null))
      .finally(() => !cancelled && setDescLoading(false));
    return () => {
      cancelled = true;
    };
  }, [item.canvasId, item.summary]);
  const eff = effortText(item);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div className="card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-2">
          <span className="mt-1 h-3.5 w-1 rounded-full" style={{ background: courseColor(item.courseName) }} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted">{item.courseName}</p>
            <p className="text-sm font-semibold text-ink">{item.name}</p>
          </div>
          <button onClick={onClose} className="shrink-0 text-muted hover:text-ink" aria-label="Close">
            <Glyph d={ICON.x} size={16} />
          </button>
        </div>
        {item.status === "overdue" && <p className="mt-2 text-xs font-medium text-danger">Past due</p>}
        <dl className="mt-3 space-y-1.5 text-xs">
          {item.dueAt && <DetailRow k="Due" v={fmtDueLong(item.dueAt)} />}
          {eff && <DetailRow k="Effort" v={eff} />}
          {item.pointsPossible != null && <DetailRow k="Points" v={`${item.pointsPossible}`} />}
          <DetailRow k="Type" v={item.type} />
        </dl>
        {desc ? (
          <p className="mt-3 rounded-md bg-surface-soft px-3 py-2 text-xs text-muted">
            <span className="font-medium text-ink">About this: </span>
            {desc}
          </p>
        ) : descLoading ? (
          <p className="mt-3 text-xs text-muted">Generating a quick description…</p>
        ) : null}
        {isStudyType(item.type) && item.status !== "done" && <StudyLeadEditor item={item} />}
        <div className="mt-4 flex items-center justify-end gap-3">
          {item.htmlUrl && (
            <a href={item.htmlUrl} target="_blank" rel="noreferrer" className="btn-primary text-sm">
              Open in Canvas ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
function DetailRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right text-ink">{v}</dd>
    </div>
  );
}

/** Per-assignment control: how many days ahead to start studying for THIS
 *  exam/quiz. Saving re-plans (router.refresh reloads the server data). */
function StudyLeadEditor({ item }: { item: CalendarItem }) {
  const router = useRouter();
  const [days, setDays] = useState(item.studyLeadDays != null ? String(item.studyLeadDays) : "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function apply() {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      const res = await fetch("/api/assignment/study-lead", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.canvasId, days: days === "" ? null : Number(days) }),
      });
      if (res.ok) {
        setSaved(true);
        router.refresh();
      } else {
        const b = await res.json().catch(() => ({}));
        setErr(typeof b.error === "string" ? b.error : "Couldn't save.");
      }
    } catch {
      setErr("Couldn't save.");
    }
    setBusy(false);
  }

  const label = item.type === "exam" ? "exam/test" : "quiz";
  return (
    <div className="mt-3 rounded-md border border-line-subtle bg-surface-soft/50 p-2.5">
      <label className="text-xs font-medium text-ink">Start studying for this {label}</label>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          type="number"
          min="1"
          max="14"
          value={days}
          onChange={(e) => {
            setDays(e.target.value);
            setSaved(false);
          }}
          className="field w-20 text-sm"
          placeholder="days"
        />
        <span className="text-xs text-muted">days ahead</span>
        <button onClick={apply} disabled={busy} className="btn-primary text-sm">
          {busy ? "Saving…" : "Apply"}
        </button>
        {saved && <span className="text-xs text-success">Re-planned ✓</span>}
      </div>
      {err && <p className="mt-1 text-xs text-danger">{err}</p>}
      <p className="mt-1 text-[11px] text-muted">
        Study spreads across those days (with ~20 min kept the day before). Leave blank to use your Settings default.
      </p>
    </div>
  );
}

export interface StudyEntry {
  canvasId: number;
  name: string;
  courseName: string;
  hours: number;
  dueAt: string; // ISO — when the exam/quiz this prepares for is due
}

/** A day expanded into a popup (from Week/Month). Lists due items (clickable →
 *  ItemDetail), study sessions, and busy blocks. Sits below ItemDetail (z-40). */
export function DayPeek({
  date,
  items,
  events,
  study,
  onSelect,
  onClose,
  onOpenDay,
}: {
  date: Date;
  items: CalendarItem[];
  events: CalendarEvent[];
  study: StudyEntry[];
  onSelect: (it: CalendarItem) => void;
  onClose: () => void;
  onOpenDay?: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const empty = items.length === 0 && events.length === 0 && study.length === 0;
  const dueShort = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div className="card max-h-[80vh] w-full max-w-md overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">{date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink" aria-label="Close">
            <Glyph d={ICON.x} size={16} />
          </button>
        </div>

        {empty && <p className="py-6 text-center text-sm text-muted">Nothing on this day.</p>}

        {items.length > 0 && (
          <section className="mt-3">
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Due ({items.length})</h3>
            <div className="space-y-1.5">
              {items.map((it) => (
                <ItemPill key={`peek-${it.canvasId}`} item={it} onSelect={onSelect} />
              ))}
            </div>
          </section>
        )}

        {study.length > 0 && (
          <section className="mt-3">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
              <Glyph d={ICON.clock} size={13} /> Study plan
            </h3>
            <ul className="mt-1.5 space-y-1">
              {study.map((s, i) => (
                <li key={`peekst-${s.canvasId}-${i}`} className="flex items-center gap-2 text-sm">
                  <span className="h-3.5 w-1 shrink-0 rounded-full" style={{ background: courseColor(s.courseName) }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-ink">Study: {s.name}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {fmtHours(s.hours)} · due {dueShort(s.dueAt)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {events.length > 0 && (
          <section className="mt-3">
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Busy</h3>
            <div className="space-y-1.5">
              {events.map((e, i) => (
                <BusyRow key={`peekev-${i}`} ev={e} />
              ))}
            </div>
          </section>
        )}

        {onOpenDay && (
          <button
            onClick={() => {
              onOpenDay();
              onClose();
            }}
            className="btn-ghost mt-4 w-full text-sm"
          >
            Open full day view →
          </button>
        )}
      </div>
    </div>
  );
}

/** Slim red strip listing overdue work. Hidden when nothing is overdue. The
 *  deadline safety net — collapsible body, but the count is always visible. */
export function AttentionBanner({ atRisk }: { atRisk: AtRiskItem[] }) {
  const [open, setOpen] = useState(false);
  const overdue = atRisk.filter((a) => a.kind === "overdue");
  if (overdue.length === 0) return null;
  return (
    <div className="mb-3 rounded-lg border border-danger/40 bg-danger-soft/60 px-3 py-2">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-danger">
          <Glyph d={ICON.alert} size={16} /> {overdue.length} overdue
        </span>
        <span className="text-xs font-medium text-danger/80">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <ul className="mt-2 space-y-1">
          {overdue.map((a) => (
            <li key={`att-${a.canvasId}`} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex min-w-0 items-center gap-1.5 text-ink">
                <CourseDot name={a.courseName} />
                {a.htmlUrl ? (
                  <a href={a.htmlUrl} target="_blank" rel="noreferrer" className="truncate hover:text-accent">
                    {a.name}
                  </a>
                ) : (
                  <span className="truncate">{a.name}</span>
                )}
              </span>
              <span className="shrink-0 rounded-full bg-danger-soft px-2 py-0.5 font-medium text-danger">Past due</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Numbered deterministic priority order (folded in from the old Plan page). */
export function RecommendedOrder({ recs }: { recs: ScoredAssignment[] }) {
  if (!recs.length) return null;
  return (
    <div className="card p-4">
      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
        <Glyph d={ICON.list} size={14} /> Do in this order
      </h2>
      <ol className="mt-2.5 space-y-1.5">
        {recs.map((r, i) => (
          <li key={`ro-${r.canvasId}`} className="flex items-center gap-2 text-sm">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{i + 1}</span>
            <CourseDot name={r.courseName} />
            <span className="min-w-0 flex-1 truncate text-ink">
              {r.htmlUrl ? (
                <a href={r.htmlUrl} target="_blank" rel="noreferrer" className="hover:text-accent">
                  {r.name}
                </a>
              ) : (
                r.name
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** AI study-coach game plan for the current period. Fails OPEN: renders nothing
 *  when the AI is unavailable — the grid + Attention + Recommended carry the load. */
export function PeriodSummary({ view, start, days }: { view: "day" | "week" | "month"; start: string; days: number }) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem("sp_coach_open") === "1");
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const q = new URLSearchParams({ view, start, days: String(days) });
    fetch(`/api/calendar/briefing?${q.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => !cancelled && setText(typeof body?.text === "string" ? body.text : null))
      .catch(() => !cancelled && setText(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [view, start, days]);

  if (!loading && !text) return null; // fail-open
  function toggle() {
    setOpen((o) => {
      const n = !o;
      try {
        localStorage.setItem("sp_coach_open", n ? "1" : "0");
      } catch {
        /* ignore */
      }
      return n;
    });
  }
  return (
    <div className="mb-3 rounded-lg border border-accent-soft bg-accent-soft/30 px-3 py-2">
      <button onClick={toggle} className="flex w-full items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-accent">
          <Glyph d={ICON.spark} size={15} /> Study coach
        </span>
        <span className="text-xs font-medium text-accent/80">{open ? "Hide" : loading ? "…" : "Show plan"}</span>
      </button>
      {open &&
        (text ? (
          <p className="mt-1.5 text-sm leading-snug text-ink">{text}</p>
        ) : (
          <p className="mt-1.5 text-sm text-muted">Reading your {view}…</p>
        ))}
    </div>
  );
}

/** Prev/Today/Next + range label + Day/Week/Month switcher. `trailing` rides the
 *  right cluster (used for the overload chip) without adding a row. */
export function PeriodToolbar({
  view,
  views,
  onView,
  label,
  onPrev,
  onNext,
  onToday,
  atToday,
  trailing,
}: {
  view: string;
  views: readonly string[];
  onView: (v: string) => void;
  label: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  atToday: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-1.5">
        <button onClick={onPrev} className="btn-ghost px-2" aria-label="Previous">
          <Glyph d={ICON.chevL} size={16} />
        </button>
        <button onClick={onToday} disabled={atToday} className="btn-ghost text-sm disabled:opacity-50">
          Today
        </button>
        <button onClick={onNext} className="btn-ghost px-2" aria-label="Next">
          <Glyph d={ICON.chevR} size={16} />
        </button>
        <span className="ml-1.5 text-sm font-semibold text-ink">{label}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" className="flex gap-1 rounded-lg border border-line-subtle bg-surface-soft p-1">
          {views.map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={v === view}
              onClick={() => onView(v)}
              className={`rounded-md px-3 py-1 text-sm font-medium capitalize transition ${
                v === view ? "bg-accent text-accent-on" : "text-muted hover:bg-surface"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        {trailing}
      </div>
    </div>
  );
}

/** Slim amber chip (warning tone, NOT red) — flags that the week's work needs more
 *  hours than the student's budget. Expands to a nudge; dismissible per session per
 *  week. Hidden below ~1h. Lives in the toolbar/header row → costs no vertical space. */
export function LoadHint({ overloadHours, weekKey }: { overloadHours: number; weekKey: string }) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(`sp_overload_dismissed_${weekKey}`) === "1");
    } catch {
      /* ignore */
    }
  }, [weekKey]);
  if (overloadHours < 1 || dismissed) return null;
  const n = Math.round(overloadHours);
  function dismiss() {
    setDismissed(true);
    setOpen(false);
    try {
      sessionStorage.setItem(`sp_overload_dismissed_${weekKey}`, "1");
    } catch {
      /* ignore */
    }
  }
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`This week is over your study budget by about ${n} hours`}
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${toneSoft.warning}`}
      >
        <Glyph d={ICON.clock} size={13} /> ~{n}h over this week
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1.5 w-64 rounded-lg border border-warning/30 bg-warning-soft/40 px-3 py-2 text-xs shadow-md">
          <p className="font-medium text-ink">This week needs ~{n}h more than you&apos;ve set aside.</p>
          <p className="mt-0.5 text-muted">Add study time in Settings, start a deadline&apos;s prep earlier, or trim lower-priority work.</p>
          <button onClick={dismiss} className="btn-ghost mt-1.5 text-xs">
            Got it
          </button>
        </div>
      )}
    </div>
  );
}
