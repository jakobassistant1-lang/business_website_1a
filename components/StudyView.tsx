"use client";

// The Study hub (/study): pick a test. The next-up assessment (per the SAME
// ranked order the dashboard uses) is the violet hero card; the rest are rows.
// All study content lives on the per-test page (/study/[canvasId]) — this page
// stays calm on purpose. The on-accent "Study" button is the emphasized action;
// "Open in Canvas" is secondary.

import Link from "next/link";
import { useEffect, useState } from "react";
import { round1 } from "@/lib/round";
import { ymd } from "@/lib/calendarDates";
import { fmtHours } from "@/components/calendar/parts";
import { DueLabel } from "@/components/DueLabel";
import { usePathname } from "next/navigation";
import { TYPE_LABEL, shortCourse, StudyChip, ChevronIcon, ExternalIcon, studyCoachCacheKey, viewerTimeZone } from "@/components/studyUi";
import type { CalendarItem } from "@/lib/calendarData";

export function StudyView({
  connected,
  assessments,
  sessions,
  todayYmd = "",
  missing = false,
  demo = false,
}: {
  connected: boolean;
  assessments: CalendarItem[];
  sessions: Record<number, { date: string; hours: number }[]>;
  /** The server's day ("YYYY-MM-DD"). Optional because the "long-time" due format
   *  used here never reads it (the first-run demo renders this without one). */
  todayYmd?: string;
  /** Arrived from /study/[canvasId] for a test that's no longer in the plan. */
  missing?: boolean;
  /** First-run demo: sample data, so no AI coach line (it would describe the
   *  signed-in student's REAL tests) and nothing cached. */
  demo?: boolean;
}) {
  // Belt and braces: the demo shell lives under /demo, so it's a demo there even
  // if a caller forgets the prop.
  const pathname = usePathname();
  const isDemo = demo || (pathname ?? "").startsWith("/demo");
  // The "that test isn't in your plan" notice lives for this visit only: the
  // ?missing=1 flag is dropped from the address bar once shown, so a refresh or a
  // later visit doesn't bring it back, and navigating away unmounts it.
  const [showMissing] = useState(missing);
  useEffect(() => {
    if (missing) window.history.replaceState(null, "", "/study");
  }, [missing]);

  // AI orientation line (fail-open: the page renders fully without it). Cached in
  // sessionStorage for the browser session, keyed by a hash of its inputs, so
  // revisiting /study doesn't re-run the skeleton and the model call.
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const testsSig = assessments.map((a) => `${a.canvasId}@${a.dueAt ?? ""}`).join("|");
  useEffect(() => {
    if (isDemo || !connected || assessments.length === 0) return;
    // Keyed on the viewer's own day, so the line turns over at local midnight.
    const key = studyCoachCacheKey(
      ymd(new Date()),
      assessments.map((a) => ({ canvasId: a.canvasId, dueAt: a.dueAt })),
    );
    let stored: string | null = null;
    try {
      stored = window.sessionStorage.getItem(key);
    } catch {}
    if (stored) {
      setAiSummary(stored);
      return;
    }
    let cancelled = false;
    setSummaryLoading(true);
    fetch(`/api/study-summary?tz=${encodeURIComponent(viewerTimeZone())}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled || !body || typeof body.summary !== "string") return;
        setAiSummary(body.summary);
        try {
          window.sessionStorage.setItem(key, body.summary);
        } catch {}
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- testsSig stands in for `assessments`
  }, [isDemo, connected, testsSig]);

  const notice = showMissing ? <MissingNotice /> : null;

  if (!connected) {
    return (
      <div className="mx-auto max-w-xl">
        <div className="card p-10 text-center">
          <h1 className="text-base font-medium text-ink">Connect Canvas to start studying.</h1>
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
        {notice}
        <div className="card p-10 text-center">
          <h1 className="text-base font-medium text-ink">No upcoming tests or quizzes.</h1>
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
      {notice}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-ink">Study</h1>
        <p className="mt-0.5 text-sm text-muted">Pick a test to get a plan, a study guide, and practice questions.</p>
        <StudyAiHeader text={aiSummary} loading={summaryLoading} />
      </div>

      {/* Featured: the next-up test. Text is `accent-on` (not white) so it keeps
          its contrast on the lighter dark-mode violet. */}
      <div data-tour="study-featured" className="rounded-xl bg-accent p-7 text-accent-on shadow-card">
        <p className="text-[13px] font-semibold text-accent-on">Next up</p>
        <p className="mt-1.5 text-[2rem] font-bold leading-[1.1] tracking-tight max-md:line-clamp-3 max-md:break-words max-md:text-2xl" title={featured.name}>{featured.name}</p>
        <p className="mt-1 text-[15px] text-accent-on">
          {TYPE_LABEL[featured.type]} · {shortCourse(featured.courseName)}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {featured.dueAt && (
            <StudyChip>
              Due <DueLabel iso={featured.dueAt} format="long-time" todayYmd={todayYmd} />
            </StudyChip>
          )}
          {featured.pointsPossible != null && featured.pointsPossible > 0 && <StudyChip>{featured.pointsPossible} pts</StudyChip>}
          <StudyChip>{fSessions.length > 0 ? `${fmtHours(totalHours)} of study scheduled` : "No study blocks scheduled yet"}</StudyChip>
        </div>
        <div className="mt-5 flex flex-col gap-2.5 sm:flex-row">
          <Link href={`/study/${featured.canvasId}`} className="max-md:tap inline-flex items-center justify-center rounded-[14px] bg-accent-on px-5 py-2.5 text-center text-sm font-semibold text-accent transition hover:bg-accent-on/90">
            Study
          </Link>
          {featured.htmlUrl && (
            <a href={featured.htmlUrl} target="_blank" rel="noreferrer" className="max-md:tap inline-flex items-center justify-center gap-1.5 rounded-[14px] border border-accent-on/40 px-5 py-2.5 text-center text-sm font-medium text-accent-on transition hover:bg-accent-hover">
              Open in Canvas
              <ExternalIcon />
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
              <Link key={a.canvasId} href={`/study/${a.canvasId}`} className="tap flex w-full items-center gap-3.5 px-1 py-3.5 transition-colors hover:bg-surface-soft">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-ink max-md:text-[16px]">{a.name}</span>
                  <span className="block truncate text-[13px] text-muted">
                    {TYPE_LABEL[a.type]} · {shortCourse(a.courseName)}
                  </span>
                </span>
                {a.dueAt && <DueLabel iso={a.dueAt} format="long-time" todayYmd={todayYmd} className="shrink-0 text-[13px] font-medium text-ink" />}
                <span className="inline-flex shrink-0 items-center gap-0.5 text-sm font-medium text-accent">
                  Study
                  <ChevronIcon />
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── One-line notice after /study/[canvasId] bounced here (#140). ──────────────
function MissingNotice() {
  return (
    <p role="status" className="mb-5 flex items-center gap-2.5 rounded-[14px] bg-accent-soft px-4 py-2.5 text-[14px] text-ink">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="shrink-0 text-accent" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 16.5v.01" strokeLinecap="round" />
      </svg>
      That test isn&apos;t in your plan anymore. Here&apos;s what&apos;s next.
    </p>
  );
}

// ── AI orientation banner — same style as the dashboard summary; fail-open:
//    renders nothing once we know there's no text. The line is a live region so
//    a screen reader hears it arrive after the loading text. ──────────────────
function StudyAiHeader({ text, loading }: { text: string | null; loading: boolean }) {
  if (!text && !loading) return null;
  return (
    <div className="mt-4 flex items-start gap-3 rounded-2xl border border-line-subtle bg-surface-soft/60 p-4">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2z" />
        </svg>
      </span>
      <p role="status" aria-live="polite" aria-busy={!text && loading} className="text-[16px] leading-relaxed text-ink">
        {text ?? <span className="text-muted">Reading your upcoming tests…</span>}
      </p>
    </div>
  );
}
