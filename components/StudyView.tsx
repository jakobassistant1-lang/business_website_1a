"use client";

// The Study hub (/study): pick a test. The next-up assessment (per the SAME
// ranked order the dashboard uses) is the violet hero card; the rest are rows.
// All study content lives on the per-test page (/study/[canvasId]) — this page
// stays calm on purpose. The white "Study" button is the emphasized action;
// "Open in Canvas" is secondary.

import Link from "next/link";
import { useEffect, useState } from "react";
import { round1 } from "@/lib/round";
import { fmtHours } from "@/components/calendar/parts";
import { TYPE_LABEL, shortCourse, dueLabel, StudyChip } from "@/components/studyUi";
import type { CalendarItem } from "@/lib/calendarData";

export function StudyView({
  connected,
  assessments,
  sessions,
}: {
  connected: boolean;
  assessments: CalendarItem[];
  sessions: Record<number, { date: string; hours: number }[]>;
}) {
  // Warm AI orientation, mirroring the dashboard's summary (fail-open: the page
  // renders fully without it; this just fills the header line when Gemini answers).
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  useEffect(() => {
    if (!connected || assessments.length === 0) return;
    let cancelled = false;
    setSummaryLoading(true);
    fetch("/api/study-summary")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!cancelled && body && typeof body.summary === "string") setAiSummary(body.summary);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connected, assessments.length]);

  if (!connected) {
    return (
      <div className="mx-auto max-w-xl">
        <div className="card p-10 text-center">
          <p className="text-base font-medium text-ink">Connect Canvas to start studying.</p>
          <p className="mt-1.5 text-sm text-muted">Once your coursework is synced, this page builds a study plan, guide, and practice questions for each upcoming test.</p>
          <Link href="/connections" className="btn-primary mt-5">Connect Canvas</Link>
        </div>
      </div>
    );
  }

  const featured = assessments[0];
  if (!featured) {
    return (
      <div className="mx-auto max-w-xl">
        <div className="card p-10 text-center">
          <p className="text-base font-medium text-ink">No upcoming tests or quizzes.</p>
          <p className="mt-1.5 text-sm text-muted">When one lands on your plan, it&apos;ll show up here with a study plan ready to go.</p>
          <Link href="/plan" className="btn-primary mt-5">Open plan</Link>
        </div>
      </div>
    );
  }

  const fSessions = sessions[featured.canvasId] ?? [];
  const totalHours = round1(fSessions.reduce((s, x) => s + x.hours, 0));
  const others = assessments.slice(1);

  return (
    <div className="mx-auto max-w-3xl">
      <StudyAiHeader text={aiSummary} loading={summaryLoading} />
      <div className="mb-6">
        <p className="text-xl font-semibold text-ink">Study</p>
        <p className="mt-0.5 text-sm text-muted">Pick a test to get a plan, a study guide, and practice questions.</p>
      </div>

      {/* Featured: the next-up test */}
      <div data-tour="study-featured" className="rounded-xl bg-accent p-7 text-white shadow-card">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-white/80">Next up</p>
        <p className="mt-1.5 text-[2rem] font-bold leading-[1.1] tracking-tight">{featured.name}</p>
        <p className="mt-1 text-[15px] text-white/80">
          {TYPE_LABEL[featured.type]} · {shortCourse(featured.courseName)}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {featured.dueAt && <StudyChip text={`Due ${dueLabel(featured.dueAt)}`} />}
          {featured.pointsPossible != null && featured.pointsPossible > 0 && <StudyChip text={`${featured.pointsPossible} pts`} />}
          <StudyChip text={fSessions.length > 0 ? `${fmtHours(totalHours)} of study scheduled` : "No study blocks scheduled"} />
        </div>
        <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
          <Link href={`/study/${featured.canvasId}`} className="rounded-[14px] bg-white px-5 py-2.5 text-center text-sm font-semibold text-accent transition hover:bg-white/90">
            Study
          </Link>
          {featured.htmlUrl && (
            <a href={featured.htmlUrl} target="_blank" rel="noreferrer" className="rounded-[14px] border border-white/40 px-5 py-2.5 text-center text-sm font-medium text-white transition hover:bg-white/10">
              Open in Canvas ↗
            </a>
          )}
        </div>
      </div>

      {/* The rest, in recommended order */}
      {others.length > 0 && (
        <div className="card mt-6 p-6">
          <h2 className="text-lg font-semibold text-ink">Also coming up</h2>
          <div className="mt-2 divide-y divide-line-subtle/70">
            {others.map((a) => (
              <Link key={a.canvasId} href={`/study/${a.canvasId}`} className="flex w-full items-center gap-3.5 px-1 py-3.5 transition-colors hover:bg-surface-soft">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-ink">{a.name}</span>
                  <span className="block truncate text-[13px] text-muted">
                    {TYPE_LABEL[a.type]} · {shortCourse(a.courseName)}
                  </span>
                </span>
                {a.dueAt && <span className="shrink-0 text-[13px] font-medium text-ink">{dueLabel(a.dueAt)}</span>}
                <span className="shrink-0 text-sm font-medium text-accent">Study →</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Warm AI orientation banner — same style as the dashboard summary; fail-open:
//    renders nothing once we know there's no text. ──────────────────────────────
function StudyAiHeader({ text, loading }: { text: string | null; loading: boolean }) {
  if (!text && !loading) return null;
  return (
    <div className="mb-6 flex items-start gap-3 rounded-2xl border border-line-subtle bg-surface-soft/60 p-4">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2z" />
        </svg>
      </span>
      <p className="text-[16px] leading-relaxed text-ink">{text ?? <span className="text-muted">Getting you oriented…</span>}</p>
    </div>
  );
}
