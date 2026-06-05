"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PlanPayload, SubmittedItem } from "@/lib/plan";
import type { PlanDay } from "@/lib/scheduler";
import { toneSoft } from "@/lib/tone";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// V3 — soft, distinct per-course dot colors (deterministic by name; data-viz
// category colors, not theme tokens).
const COURSE_COLORS = ["#7c5cf0", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#6366f1", "#14b8a6"];
function courseColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return COURSE_COLORS[h % COURSE_COLORS.length];
}
function CourseDot({ name }: { name: string }) {
  return <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: courseColor(name) }} />;
}

// V4 — small inline glyphs (inherit currentColor).
const ICON = {
  sun: "M12 3v2M12 19v2M5 5l1.4 1.4M17.6 17.6 19 19M3 12h2M19 12h2M5 19l1.4-1.4M17.6 6.4 19 5M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  calendar: "M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z",
  alert: "M12 9v4M12 17h.01M10.3 4.3 2.7 18a1.5 1.5 0 0 0 1.3 2.2h16a1.5 1.5 0 0 0 1.3-2.2L13.7 4.3a1.5 1.5 0 0 0-2.6 0Z",
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  list: "M8 6h12M8 12h12M8 18h12M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  inbox: "M3 12h5l2 3h4l2-3h5M5 5h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z",
  check: "M20 6 9 17l-5-5",
};
function Glyph({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
      <path d={d} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function fmtDayLabel(dateStr: string, weekday: string) {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${weekday} · ${MONTHS[m - 1]} ${d}`;
}
function fmtSynced(iso: string | null) {
  if (!iso) return "never";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function fmtDue(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function PlanView({ initial, userName = "" }: { initial: PlanPayload; userName?: string }) {
  const [payload, setPayload] = useState<PlanPayload>(initial);
  const [hours, setHours] = useState<string>(String(initial.hours));
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "warn" | "error"; text: string } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const didAutoSync = useRef(false);

  // FR-6: sync automatically once per browser session (≈ on login).
  useEffect(() => {
    if (!payload.connected || didAutoSync.current) return;
    didAutoSync.current = true;
    if (typeof window !== "undefined" && sessionStorage.getItem("sp_autosynced")) return;
    sessionStorage.setItem("sp_autosynced", "1");
    void runSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reloadPlan(h?: string) {
    const q = h ? `?hours=${encodeURIComponent(h)}` : "";
    const res = await fetch(`/api/plan${q}`);
    if (res.ok) setPayload(await res.json());
  }

  async function runSync() {
    setSyncing(true);
    setNotice(null);
    const res = await fetch("/api/sync", { method: "POST" });
    const result = await res.json().catch(() => ({}));
    setSyncing(false);
    setWarnings(result.failedCourses ?? []);
    if (result.ok) {
      setNotice({ kind: result.failedCourses?.length ? "warn" : "ok", text: result.message });
    } else {
      setNotice({ kind: "error", text: result.message ?? "Sync failed." });
    }
    await reloadPlan(hours);
  }

  async function applyHours(e: React.FormEvent) {
    e.preventDefault();
    const h = Number(hours);
    if (!(h > 0 && h <= 24)) {
      setNotice({ kind: "error", text: "Hours must be greater than 0 and at most 24." });
      return;
    }
    setNotice(null);
    await reloadPlan(hours);
  }

  const { plan } = payload;
  const submitted = payload.submitted ?? [];
  const firstName = userName.trim().split(/\s+/)[0];
  const todayLong = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const statusPill = !payload.connected
    ? { text: "Not connected", cls: toneSoft.neutral }
    : payload.syncedAt === null
    ? { text: "Not synced yet", cls: toneSoft.neutral }
    : payload.stale
    ? { text: "Stale data", cls: toneSoft.warning }
    : { text: "Up to date", cls: toneSoft.success };

  const atRiskCount = plan.atRisk.filter((a) => a.kind === "insufficient_time").length;
  const hasAssignments =
    plan.days.some((d) => d.blocks.length > 0) || plan.atRisk.length > 0 || plan.undated.length > 0;

  return (
    <div>
      {/* Header (V7) */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting()}{firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {todayLong} · {plan.days.length}-day plan
            <span className={`ml-3 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${statusPill.cls}`}>
              {statusPill.text}
            </span>
          </p>
          <p className="mt-1 text-xs text-muted">
            Last synced: {fmtSynced(payload.syncedAt)}
            {payload.accountName ? ` · ${payload.accountName}` : ""}
          </p>
        </div>
        <button onClick={runSync} className="btn-ghost" disabled={syncing || !payload.connected}>
          {syncing ? "Syncing…" : "Sync from Canvas"}
        </button>
      </div>

      {/* Notices */}
      {notice && (
        <div
          className={`mt-4 rounded-lg px-4 py-3 text-sm ${
            notice.kind === "ok" ? toneSoft.success : notice.kind === "warn" ? toneSoft.warning : toneSoft.danger
          }`}
        >
          {notice.text}
          {warnings.length > 0 && <span className="block text-xs opacity-80">Failed: {warnings.join(", ")}</span>}
        </div>
      )}

      {/* Not connected (V8) */}
      {!payload.connected && (
        <div className="card mt-6 p-8 text-center">
          <div className="flex justify-center text-accent"><Glyph d={ICON.calendar} size={32} /></div>
          <p className="mt-3 text-sm font-medium text-ink">Let&apos;s build your plan.</p>
          <p className="mt-1 text-sm text-muted">Connect your Canvas account and we&apos;ll turn your assignments into a daily plan.</p>
          <Link href="/connections" className="btn-primary mt-4">Connect Canvas</Link>
        </div>
      )}

      {payload.connected && (
        <>
          {/* Hours + summary */}
          <div className="mt-6 grid gap-4 sm:grid-cols-[auto_1fr]">
            <form onSubmit={applyHours} className="card p-4">
              <label className="label" htmlFor="hours">
                Hours for this plan <span className="font-normal text-muted">· default in Settings</span>
              </label>
              <div className="flex items-end gap-3">
                <input
                  id="hours" type="number" min="0.5" max="24" step="0.5"
                  className="field w-28" value={hours} onChange={(e) => setHours(e.target.value)}
                />
                <button type="submit" className="btn-primary">Apply</button>
              </div>
            </form>
            <div className="card grid grid-cols-4 divide-x divide-line-subtle p-4 text-center">
              <Stat icon={ICON.list} label="Due in window" value={plan.inWindowDueCount} />
              <Stat icon={ICON.alert} label="At risk" value={atRiskCount} accent={atRiskCount > 0} />
              <Stat icon={ICON.clock} label="Planned hrs" value={plan.totalPlannedHours} />
              <Stat icon={ICON.check} label="Submitted" value={submitted.length} positive={submitted.length > 0} />
            </div>
          </div>

          {/* Empty state (V8) */}
          {!hasAssignments && submitted.length === 0 && (
            <div className="card mt-6 p-8 text-center">
              <div className="flex justify-center text-muted"><Glyph d={ICON.inbox} size={32} /></div>
              <p className="mt-3 text-sm font-medium text-ink">Nothing to plan yet.</p>
              <p className="mt-1 text-sm text-muted">
                {payload.stale
                  ? "We couldn't reach Canvas and there's nothing cached. Try Sync once Canvas is back."
                  : "Hit Sync from Canvas to pull your latest coursework."}
              </p>
            </div>
          )}

          {/* AT_RISK */}
          {plan.atRisk.length > 0 && (
            <section className="mt-8">
              <SectionHeader icon={ICON.alert} className="text-danger" text="Needs attention" />
              <div className="mt-3 space-y-2">
                {plan.atRisk.map((a) => (
                  <div key={`risk-${a.canvasId}`} className="card flex items-center justify-between border-danger/30 bg-danger-soft/40 p-3.5 transition hover:-translate-y-px hover:shadow-md">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        {a.htmlUrl ? <a href={a.htmlUrl} target="_blank" rel="noreferrer" className="hover:text-accent">{a.name}</a> : a.name}
                      </p>
                      <p className="flex items-center gap-1.5 truncate text-xs text-muted">
                        <CourseDot name={a.courseName} />{a.courseName} · due {fmtDue(a.dueAt)}
                      </p>
                    </div>
                    <span className="ml-3 shrink-0 rounded-full bg-danger-soft px-2.5 py-0.5 text-xs font-medium text-danger">
                      {a.kind === "overdue" ? "Past due" : `+${a.shortfallHours}h won't fit`}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Today (pinned) + Upcoming (P3) */}
          {hasAssignments && (
            <>
              <section className="mt-8">
                <SectionHeader icon={ICON.sun} className="text-accent" text="Today" />
                <div className="mt-3"><DayCard day={plan.days[0]} today /></div>
              </section>
              {plan.days.length > 1 && (
                <section className="mt-8">
                  <SectionHeader icon={ICON.calendar} className="text-muted" text="Upcoming" />
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {plan.days.slice(1).map((day) => <DayCard key={day.date} day={day} />)}
                  </div>
                </section>
              )}
            </>
          )}

          {/* Undated */}
          {plan.undated.length > 0 && (
            <section className="mt-8">
              <SectionHeader icon={ICON.inbox} className="text-muted" text="No due date" />
              <div className="mt-3 space-y-2">
                {plan.undated.map((u) => (
                  <div key={`und-${u.canvasId}`} className="card flex items-center justify-between p-3.5 transition hover:-translate-y-px hover:shadow-md">
                    <p className="truncate text-sm text-ink">
                      {u.htmlUrl ? <a href={u.htmlUrl} target="_blank" rel="noreferrer" className="hover:text-accent">{u.name}</a> : u.name}
                    </p>
                    <span className="ml-3 flex shrink-0 items-center gap-1.5 text-xs text-muted"><CourseDot name={u.courseName} />{u.courseName}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Submitted / Completed */}
          {submitted.length > 0 && (
            <section className="mt-8">
              <SectionHeader icon={ICON.check} className="text-success" text="Completed" />
              <div className="mt-3 space-y-2">
                {submitted.map((s: SubmittedItem) => (
                  <div key={`sub-${s.canvasId}`} className="card flex items-center justify-between border-success/30 bg-success-soft/40 p-3.5 transition hover:-translate-y-px hover:shadow-md">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        {s.htmlUrl ? <a href={s.htmlUrl} target="_blank" rel="noreferrer" className="hover:text-accent">{s.name}</a> : s.name}
                      </p>
                      <p className="flex items-center gap-1.5 truncate text-xs text-muted">
                        <CourseDot name={s.courseName} />{s.courseName} · submitted {fmtDue(s.submittedAt)}
                      </p>
                    </div>
                    <div className="ml-3 shrink-0">
                      <span className="rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-medium text-success">
                        {s.submissionScore !== null && s.pointsPossible !== null ? `${s.submissionScore}/${s.pointsPossible}pts` : "✓ Done"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function SectionHeader({ icon, className, text }: { icon: string; className: string; text: string }) {
  return (
    <h2 className={`flex items-center gap-2 text-sm font-semibold uppercase tracking-wide ${className}`}>
      <Glyph d={icon} size={15} />{text}
    </h2>
  );
}

function DayCard({ day, today }: { day: PlanDay; today?: boolean }) {
  const pct = day.capacity > 0 ? Math.min(100, (day.allocated / day.capacity) * 100) : 0;
  return (
    <div className={`card p-4 transition hover:-translate-y-px hover:shadow-md ${today ? "ring-2 ring-accent-ring bg-accent-soft/30" : ""}`}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-ink">
          {fmtDayLabel(day.date, day.weekday)} {today && <span className="text-accent">· Today</span>}
        </p>
        <span className="text-xs text-muted">{day.allocated}/{day.capacity}h</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-soft">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-3 space-y-2">
        {day.blocks.length === 0 && <p className="text-xs text-muted">No work scheduled.</p>}
        {day.blocks.map((b, i) => (
          <div key={`${day.date}-${b.canvasId}-${i}`} className="flex items-start gap-2.5">
            <span className="mt-0.5 shrink-0 rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
              {b.hours}h
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm text-ink">
                {b.htmlUrl ? <a href={b.htmlUrl} target="_blank" rel="noreferrer" className="hover:text-accent">{b.name}</a> : b.name}
              </p>
              <p className="flex items-center gap-1.5 truncate text-xs text-muted">
                <CourseDot name={b.courseName} />{b.courseName} · due {fmtDue(b.dueAt)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ icon, label, value, accent, positive }: { icon: string; label: string; value: number; accent?: boolean; positive?: boolean }) {
  const cls = accent ? "text-danger" : positive ? "text-success" : "text-ink";
  return (
    <div className="px-2">
      <p className={`text-2xl font-semibold ${cls}`}>{value}</p>
      <p className="flex items-center justify-center gap-1 text-xs text-muted">
        <Glyph d={icon} size={13} />{label}
      </p>
    </div>
  );
}
