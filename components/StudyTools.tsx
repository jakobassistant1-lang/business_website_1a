"use client";

// The per-test study tools page (/study/[canvasId]). One tool visible at a time
// via tabs — How to study / Study guide / Practice — so a student is never hit
// with three walls of content at once (UX decision: tabs over separate pages =
// shared test context + one-click switching; over a stacked page = no overwhelm).
// Each tab lazy-generates on FIRST open (server-cached afterwards); practice
// questions stay behind an explicit Generate with a type dropdown.
//
// Generation requests use PER-KIND sequence counters. A single shared counter
// caused the launch bug: plan+guide fired together, guide bumped the counter,
// and the plan's response was discarded as "stale" — an eternal skeleton.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { fmtHours, StudyLeadEditor } from "@/components/calendar/parts";
import { round1 } from "@/lib/round";
import { toneSoft } from "@/lib/tone";
import { NETWORK_ERROR, SERVER_ERROR } from "@/lib/messages";
import { TYPE_LABEL, shortCourse, sessionDateLabel, StudyChip, ChevronIcon, ExternalIcon, studySessionCount } from "@/components/studyUi";
import { nextIndex } from "@/lib/keyboardNav";
import { DueLabel } from "@/components/DueLabel";
import {
  QUESTION_TYPES,
  gradeShortAnswer,
  type StudyGuideContent,
  type StudyPlanContent,
  type StudyQuestion,
  type StudyQuestionType,
  type StudyQuestionsContent,
} from "@/lib/studyShared";
import type { CalendarItem } from "@/lib/calendarData";
import { NotesSection } from "@/components/NotesSection";

type Kind = "plan" | "guide" | "questions";
type Tab = Kind | "notes"; // "notes" manages your uploads — it is NOT an AI-generated kind
type Gen<T> = { status: "idle" | "loading" | "ready" | "error"; content: T | null; error: string | null };
const IDLE: Gen<never> = { status: "idle", content: null, error: null };

const TABS: { id: Tab; label: string }[] = [
  { id: "plan", label: "How to study" },
  { id: "guide", label: "Study guide" },
  { id: "questions", label: "Practice" },
  { id: "notes", label: "Your notes" },
];

async function postStudy<T>(body: Record<string, unknown>): Promise<{ ok: true; content: T; cached: boolean } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/study", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), // the server reads the student's zone itself (#145)
    });
    const json = await res.json().catch(() => null);
    if (res.ok && json?.ok) return { ok: true, content: json.content as T, cached: json.cached === true };
    // A 5xx with no JSON body (a crashed route) is Navo's failure, not the
    // student's connection — SERVER_ERROR, never NETWORK_ERROR (#146).
    if (json === null && res.status >= 500) return { ok: false, error: "server" };
    return { ok: false, error: typeof json?.error === "string" ? json.error : "failed" };
  } catch {
    return { ok: false, error: "network" };
  }
}

const ERROR_TEXT: Record<string, string> = {
  no_key: "The AI service isn’t configured.",
  timeout: "Generation took too long.",
  http_error: "The AI service didn’t answer. Try again in a minute.",
  bad_response: "The AI answer came back unreadable. Try again.",
  not_connected: "Connect your Canvas account first.",
  network: NETWORK_ERROR,
  server: SERVER_ERROR,
};
const errText = (code: string | null) => (code && ERROR_TEXT[code]) || "This couldn’t be generated. Try again.";

export function StudyTools({
  assessment,
  sessions,
  isNextUp,
  todayYmd = "",
  timeZone,
}: {
  assessment: CalendarItem;
  /** This test's study sessions — lib/study.studySessionsFor (the one
   *  isStudySessionBlock rule), never by reading `.study` here. */
  sessions: { date: string; hours: number }[];
  isNextUp: boolean;
  /** Today in the student's zone ("YYYY-MM-DD"). */
  todayYmd?: string;
  /** The student's Canvas zone (lib/studentZone): the due date renders in it. */
  timeZone?: string;
}) {
  const [tab, setTab] = useState<Tab>("plan");
  const [plan, setPlan] = useState<Gen<StudyPlanContent>>(IDLE);
  const [guide, setGuide] = useState<Gen<StudyGuideContent>>(IDLE);
  const [questions, setQuestions] = useState<Gen<StudyQuestionsContent>>(IDLE);
  const [qType, setQType] = useState<StudyQuestionType>("multiple_choice");
  const [setId, setSetId] = useState(0);
  const [noteCount, setNoteCount] = useState(0);
  // Guide/practice are server-cached and don't auto-refresh when notes change, so
  // we track which kinds are stale (a note was added/deleted since they were made)
  // and show a regenerate nudge. A FRESH (non-cached) generation clears it.
  const [stale, setStale] = useState<{ guide: boolean; questions: boolean }>({ guide: false, questions: false });
  // One counter PER kind — a shared counter let one tool's request mark the
  // other's response stale (the "plan never appears" bug).
  const seqs = useRef<Record<Kind, number>>({ plan: 0, guide: 0, questions: 0 });

  const load = useCallback(
    async (kind: Kind, opts?: { force?: boolean; questionType?: StudyQuestionType }) => {
      const seq = ++seqs.current[kind];
      const set = kind === "plan" ? setPlan : kind === "guide" ? setGuide : setQuestions;
      set({ status: "loading", content: null, error: null });
      const res = await postStudy<never>({
        canvasId: assessment.canvasId,
        kind,
        force: opts?.force,
        questionType: opts?.questionType,
      });
      if (seq !== seqs.current[kind]) return; // a newer request for THIS kind superseded us
      if (res.ok) {
        set({ status: "ready", content: res.content, error: null });
        if (kind === "questions") setSetId((n) => n + 1);
        // A freshly generated (non-cached) guide/practice already reflects current
        // notes → no longer stale. A cached serve leaves the flag as-is.
        if (!res.cached && (kind === "guide" || kind === "questions")) setStale((s) => ({ ...s, [kind]: false }));
      } else {
        set({ status: "error", content: null, error: res.error });
      }
    },
    [assessment.canvasId],
  );

  // A note was added/deleted → both cached generations are now out of date.
  const markNotesChanged = useCallback(() => setStale({ guide: true, questions: true }), []);

  // Lazy-load: generate a tab's content the first time it's opened (questions
  // stay behind their explicit Generate button).
  useEffect(() => {
    if (tab === "plan" && plan.status === "idle") void load("plan");
    if (tab === "guide" && guide.status === "idle") void load("guide");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, load]);

  const totalHours = round1(sessions.reduce((s, x) => s + x.hours, 0));

  // Tablist keyboard model (WAI-ARIA tabs, automatic activation): Left/Right
  // (wrapping) and Home/End move focus AND select; only the selected tab is in
  // the Tab order. The focused tab is scrolled into view inside the scroller.
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabIds = useId();
  const tabId = (t: Tab) => `${tabIds}-tab-${t}`;
  const panelId = (t: Tab) => `${tabIds}-panel-${t}`;

  // Phones: the tab row is wider than the screen ("Your notes" starts off-screen).
  // While there's more to the right, the row's right edge fades out so it reads
  // as scrollable; the fade drops once the row is scrolled to its end.
  const tabListRef = useRef<HTMLDivElement | null>(null);
  const [moreRight, setMoreRight] = useState(false);
  const updateMoreRight = useCallback(() => {
    const el = tabListRef.current;
    if (el) setMoreRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 6); // ≥6px: sub-pixel/snap slop isn't "more"
  }, []);
  useEffect(() => {
    updateMoreRight();
    window.addEventListener("resize", updateMoreRight);
    return () => window.removeEventListener("resize", updateMoreRight);
  }, [updateMoreRight, noteCount]);
  const onTabKey = (e: React.KeyboardEvent) => {
    const next = nextIndex(e.key, TABS.findIndex((t) => t.id === tab), TABS.length); // the shared roving-focus rule
    if (next == null) return;
    e.preventDefault();
    setTab(TABS[next].id);
    const el = tabRefs.current[next];
    el?.focus();
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/study" className="max-md:tap max-md:-my-3 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
        <ChevronIcon dir="left" />
        All tests
      </Link>

      {/* Compact test header — same violet language as the hub's hero */}
      <div className="mt-3 rounded-xl bg-accent p-5 text-accent-on shadow-card">
        <p className="text-[13px] font-semibold text-accent-on">{isNextUp ? "Next test" : "Studying for"}</p>
        <h1 className="mt-1 text-xl font-bold leading-tight tracking-tight sm:text-2xl">{assessment.name}</h1>
        <p className="mt-0.5 text-sm text-accent-on">
          {TYPE_LABEL[assessment.type]} · {shortCourse(assessment.courseName)}
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {assessment.dueAt && (
            <StudyChip>
              Due <DueLabel iso={assessment.dueAt} format="long-time" todayYmd={todayYmd} timeZone={timeZone} />
            </StudyChip>
          )}
          {assessment.pointsPossible != null && assessment.pointsPossible > 0 && <StudyChip>{assessment.pointsPossible} pts</StudyChip>}
          {assessment.htmlUrl && (
            <a href={assessment.htmlUrl} target="_blank" rel="noreferrer" className="max-md:tap focus-visible:outline-accent-on ml-auto inline-flex items-center gap-1 rounded-full border border-accent-on/40 px-3 py-1 text-xs font-medium max-md:px-4 max-md:text-[14px] text-accent-on transition hover:bg-accent-hover">
              Open in Canvas
              <ExternalIcon />
            </a>
          )}
        </div>
      </div>

      {/* Tabs — on phones a full-width, horizontally scrolling segmented control
          (44px tabs, snap-aligned, no scrollbar). While more tabs sit off to the
          right, the row's right edge fades out (a mask, so it works on any
          background) to show it scrolls. md+ unchanged. Tabs use the GLOBAL focus
          outline (accent, 2px offset); the scroller's p-1 leaves room for it. */}
      <div
        ref={tabListRef}
        onScroll={updateMoreRight}
        className={`mt-5 inline-flex max-w-full snap-x gap-1 overflow-x-auto rounded-full bg-surface-soft p-1 max-md:flex max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden ${
          moreRight ? "max-md:[-webkit-mask-image:linear-gradient(to_right,black_78%,transparent)] max-md:[mask-image:linear-gradient(to_right,black_78%,transparent)]" : ""
        }`}
        role="tablist"
        aria-label="Study tools"
        onKeyDown={onTabKey}
      >
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            id={tabId(t.id)}
            aria-controls={tab === t.id ? panelId(t.id) : undefined} // only the rendered panel exists
            aria-selected={tab === t.id}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            className={`max-md:tap shrink-0 snap-start whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition max-md:text-[15px] ${
              tab === t.id ? "bg-accent text-accent-on" : "text-muted hover:text-ink"
            }`}
          >
            {t.id === "notes" && noteCount > 0 ? `${t.label} · ${noteCount}` : t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)} tabIndex={0} className="mt-4 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        {tab === "plan" && <PlanSection plan={plan} assessment={assessment} sessions={sessions} totalHours={totalHours} onRetry={() => load("plan")} onRegen={() => load("plan", { force: true })} />}
        {tab === "guide" && <GuideSection guide={guide} stale={stale.guide} onRetry={() => load("guide")} onRegen={() => load("guide", { force: true })} />}
        {tab === "questions" && (
          <QuestionsSection
            questions={questions}
            qType={qType}
            setQType={setQType}
            setKey={setId}
            stale={stale.questions}
            onGenerate={(force) => load("questions", { force, questionType: qType })}
          />
        )}
        {tab === "notes" && <NotesSection canvasId={assessment.canvasId} onNotesChanged={markNotesChanged} onCountChange={setNoteCount} />}
      </div>
    </div>
  );
}

function SectionShell({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        {aside}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Skeleton({ lines }: { lines: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-2.5">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} aria-hidden="true" className={`h-4 animate-pulse rounded-md bg-surface-soft ${i % 3 === 2 ? "w-2/3" : "w-full"}`} />
      ))}
      <p className="pt-1 text-xs text-muted">Generating. This usually takes 5 to 20 seconds.</p>
    </div>
  );
}

function ErrorBox({ code, onRetry }: { code: string | null; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-[14px] border border-danger/30 bg-danger-soft/40 px-4 py-3">
      <p className="text-sm text-danger">{errText(code)}</p>
      <button onClick={onRetry} className="max-md:tap mt-2 inline-flex items-center text-sm font-medium text-accent hover:underline">Try again</button>
    </div>
  );
}

function RegenButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="max-md:tap max-md:-my-3 max-md:-mr-2 inline-flex shrink-0 items-center justify-center text-[13px] font-medium text-muted transition-colors hover:text-accent max-md:px-2 max-md:text-[14px]">
      Regenerate
    </button>
  );
}

function SourceNote({ sparse, sources, excluded = [], noteCount = 0 }: { sparse: boolean; sources: string[]; excluded?: string[]; noteCount?: number }) {
  const basedOn = !sparse && sources.length > 0;
  if (!sparse && !basedOn && excluded.length === 0 && noteCount === 0) return null;
  return (
    <div className="mt-4 space-y-1.5">
      {sparse ? (
        <p className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${toneSoft.warning}`}>
          Canvas has little material for this test, so this is built from its title, description and the subject.
        </p>
      ) : basedOn ? (
        <p className="text-xs text-muted">
          Based on: {sources.slice(0, 5).join(" · ")}
          {sources.length > 5 ? " · …" : ""}
        </p>
      ) : null}
      {noteCount > 0 && (
        <p className="text-xs font-medium text-accent">
          Includes {noteCount} of your own note{noteCount === 1 ? "" : "s"}.
        </p>
      )}
      {excluded.length > 0 && (
        <p className="text-xs text-muted">
          Not included (judged off-topic): {excluded.slice(0, 4).join(" · ")}
          {excluded.length > 4 ? " · …" : ""}
        </p>
      )}
    </div>
  );
}

// Shown above a cached guide/practice set after the student adds or removes notes:
// the generation won't reflect them until regenerated (force).
function StaleNote({ onRegen, label }: { onRegen: () => void; label: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[14px] bg-accent-soft px-4 py-2.5 text-[13px] text-accent">
      <span>You’ve added or changed notes since this was made. Regenerate to include them.</span>
      <button onClick={onRegen} className="max-md:tap inline-flex shrink-0 items-center font-semibold hover:underline max-md:text-[14px]">
        {label}
      </button>
    </div>
  );
}

function PlanSection({
  plan,
  assessment,
  sessions,
  totalHours,
  onRetry,
  onRegen,
}: {
  plan: Gen<StudyPlanContent>;
  assessment: CalendarItem;
  sessions: { date: string; hours: number }[];
  totalHours: number;
  onRetry: () => void;
  onRegen: () => void;
}) {
  const header =
    sessions.length > 0
      ? `Your plan has ${studySessionCount(sessions.length)} · ${fmtHours(totalHours)} before the test.`
      : "No study sessions are scheduled for this test yet. Here’s how to use the time you have.";

  return (
    <SectionShell title="How to study this" aside={plan.status === "ready" ? <RegenButton onClick={onRegen} /> : undefined}>
      <p className="text-sm text-muted">{header}</p>
      {/* When to start studying — re-plans on save. Lives here (the study flow) now
          that the dashboard routes tests straight to this page. */}
      <StudyLeadEditor item={assessment} />
      <div className="mt-3">
        {plan.status === "loading" && <Skeleton lines={4} />}
        {plan.status === "error" && <ErrorBox code={plan.error} onRetry={onRetry} />}
        {plan.status === "ready" && plan.content && (
          <>
            {plan.content.advice && <p className="text-sm text-ink">{plan.content.advice}</p>}
            {plan.content.sessions.length > 0 && (
              <div className="mt-3 space-y-2.5">
                {plan.content.sessions.map((s, i) => (
                  <div key={`${s.date}-${i}`} className="rounded-[14px] border-l-[3px] border-accent bg-accent-soft/40 px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold text-ink">
                        Study session {i + 1} · {sessionDateLabel(s.date)}
                      </p>
                      <span className="text-[13px] font-medium text-accent">{fmtHours(s.hours)}</span>
                    </div>
                    <p className="mt-1 text-sm text-ink">{s.focus}</p>
                    {s.techniques.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {s.techniques.map((t) => (
                          <span key={t} className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">{t}</span>
                        ))}
                      </div>
                    )}
                    {s.activities.length > 0 && (
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-muted">
                        {s.activities.map((act, j) => (
                          <li key={j}>{act}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </SectionShell>
  );
}

function GuideSection({ guide, stale, onRetry, onRegen }: { guide: Gen<StudyGuideContent>; stale: boolean; onRetry: () => void; onRegen: () => void }) {
  return (
    <SectionShell title="Study guide" aside={guide.status === "ready" ? <RegenButton onClick={onRegen} /> : undefined}>
      {guide.status === "loading" && <Skeleton lines={6} />}
      {guide.status === "error" && <ErrorBox code={guide.error} onRetry={onRetry} />}
      {guide.status === "ready" && guide.content && (
        <>
          {stale && <StaleNote onRegen={onRegen} label="Regenerate" />}
          {guide.content.overview && <p className="text-sm text-muted">{guide.content.overview}</p>}
          <div className="mt-3 space-y-5">
            {guide.content.sections.map((sec, i) => (
              <div key={i}>
                <h3 className="text-[15px] font-semibold text-ink">{sec.title}</h3>
                <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-ink">
                  {sec.points.map((p, j) => (
                    <li key={j}>{p}</li>
                  ))}
                </ul>
                {sec.terms.length > 0 && (
                  <dl className="mt-2 space-y-1">
                    {sec.terms.map((t) => (
                      <div key={t.term} className="flex gap-2 text-[13px]">
                        <dt className="shrink-0 font-semibold text-accent">{t.term}</dt>
                        <dd className="text-muted">— {t.def}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            ))}
          </div>
          <SourceNote sparse={guide.content.sparse} sources={guide.content.sources} excluded={guide.content.excluded} noteCount={guide.content.noteCount} />
        </>
      )}
    </SectionShell>
  );
}

function QuestionsSection({
  questions,
  qType,
  setQType,
  setKey,
  stale,
  onGenerate,
}: {
  questions: Gen<StudyQuestionsContent>;
  qType: StudyQuestionType;
  setQType: (t: StudyQuestionType) => void;
  setKey: number;
  stale: boolean;
  onGenerate: (force: boolean) => void;
}) {
  const [results, setResults] = useState<Record<number, boolean>>({});
  useEffect(() => setResults({}), [setKey]);
  const answered = Object.keys(results).length;
  const correct = Object.values(results).filter(Boolean).length;
  const ready = questions.status === "ready" && questions.content;

  return (
    <SectionShell title="Practice questions">
      <div className="flex flex-wrap items-center gap-2.5">
        <select className="field max-md:tap w-auto" value={qType} onChange={(e) => setQType(e.target.value as StudyQuestionType)} aria-label="Question type">
          {QUESTION_TYPES.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <button onClick={() => onGenerate(false)} disabled={questions.status === "loading"} className="btn-primary max-md:tap text-sm">
          {questions.status === "loading" ? "Generating…" : ready ? "Generate (new type)" : "Generate questions"}
        </button>
        {ready && (
          <button onClick={() => onGenerate(true)} className="max-md:tap inline-flex items-center text-[13px] font-medium text-muted transition-colors hover:text-accent max-md:px-2 max-md:text-[14px]">
            New set
          </button>
        )}
      </div>

      <div className="mt-4">
        {questions.status === "idle" && <p className="text-sm text-muted">Pick a question type and generate a practice set from this test’s material.</p>}
        {questions.status === "loading" && <Skeleton lines={5} />}
        {questions.status === "error" && <ErrorBox code={questions.error} onRetry={() => onGenerate(false)} />}
        {ready && (
          <div key={setKey} className="space-y-3.5">
            {stale && <StaleNote onRegen={() => onGenerate(true)} label="New set" />}
            {questions.content!.questions.map((q, i) => (
              <QuestionCard key={i} q={q} index={i} onResult={(ok) => setResults((r) => ({ ...r, [i]: ok }))} />
            ))}
            {answered === questions.content!.questions.length && (
              <p className="rounded-[14px] bg-accent-soft px-4 py-3 text-sm font-semibold text-accent">
                {correct} of {questions.content!.questions.length} correct. {correct === questions.content!.questions.length ? "You’re ready for this one." : "Review the explanations above, then try a new set."}
              </p>
            )}
            <SourceNote sparse={questions.content!.sparse} sources={[]} excluded={questions.content!.excluded} noteCount={questions.content!.noteCount} />
          </div>
        )}
      </div>
    </SectionShell>
  );
}

// After an answer the choices stay FOCUSABLE (aria-disabled, clicks ignored by
// the `done` guard) so keyboard focus doesn't fall back to <body>. The result is
// spelled out in text ("Correct answer" / "Your answer"), not by colour alone, and
// the verdict sits in a status region that screen readers announce.
function QuestionCard({ q, index, onResult }: { q: StudyQuestion; index: number; onResult: (ok: boolean) => void }) {
  const [picked, setPicked] = useState<number | boolean | null>(null);
  const [saText, setSaText] = useState("");
  const [saResult, setSaResult] = useState<boolean | null>(null);
  const done = picked !== null || saResult !== null;
  const inputId = useId();

  function answerMcq(i: number) {
    if (done || q.kind !== "multiple_choice") return;
    setPicked(i);
    onResult(i === q.answer);
  }
  function answerTf(v: boolean) {
    if (done || q.kind !== "true_false") return;
    setPicked(v);
    onResult(v === q.answer);
  }
  function checkSa(e: React.FormEvent) {
    e.preventDefault();
    if (done || q.kind !== "short_answer" || !saText.trim()) return;
    const ok = gradeShortAnswer(saText, q.acceptable);
    setSaResult(ok);
    onResult(ok);
  }

  const gotIt = q.kind === "short_answer" ? saResult === true : picked === q.answer;
  const choiceCls = (isAnswer: boolean, isPicked: boolean) =>
    !done
      ? "border-line bg-surface hover:border-accent-ring"
      : isAnswer
        ? "border-success bg-success-soft text-success"
        : isPicked
          ? "border-danger bg-danger-soft text-danger"
          : "border-line-subtle bg-surface opacity-60";

  return (
    <div className="rounded-[14px] border border-line-subtle bg-surface-soft/50 px-4 py-3.5">
      <p className="text-sm font-medium text-ink">
        {index + 1}. {q.prompt}
      </p>

      {q.kind === "multiple_choice" && (
        <div className="mt-2.5 space-y-1.5">
          {q.choices.map((c, i) => {
            const isAnswer = i === q.answer;
            const isPicked = picked === i;
            return (
              <button key={i} onClick={() => answerMcq(i)} aria-disabled={done || undefined} className={`max-md:tap flex w-full items-center justify-between gap-3 rounded-[14px] border px-3.5 py-2 text-left text-sm transition max-md:py-2.5 max-md:text-[15px] aria-disabled:cursor-default ${choiceCls(isAnswer, isPicked)}`}>
                <span className="min-w-0">{c}</span>
                {done && <AnswerMark isAnswer={isAnswer} isPicked={isPicked} />}
              </button>
            );
          })}
        </div>
      )}

      {q.kind === "true_false" && (
        <div className="mt-2.5 flex gap-2 max-md:flex-col">
          {([true, false] as const).map((v) => {
            const isAnswer = v === q.answer;
            const isPicked = picked === v;
            return (
              <button key={String(v)} onClick={() => answerTf(v)} aria-disabled={done || undefined} className={`max-md:tap inline-flex items-center justify-center gap-2 rounded-[14px] border px-5 py-2 text-sm font-medium transition max-md:w-full max-md:justify-between max-md:text-[15px] aria-disabled:cursor-default ${choiceCls(isAnswer, isPicked)}`}>
                {v ? "True" : "False"}
                {done && <AnswerMark isAnswer={isAnswer} isPicked={isPicked} />}
              </button>
            );
          })}
        </div>
      )}

      {q.kind === "short_answer" && (
        <form onSubmit={checkSa} className="mt-2.5">
          <label htmlFor={inputId} className="mb-1 block text-[13px] font-medium text-muted">
            Your answer
          </label>
          <div className="flex gap-2">
            <input id={inputId} className="field flex-1" value={saText} onChange={(e) => setSaText(e.target.value)} placeholder="Type your answer" readOnly={done} />
            <button type="submit" aria-disabled={done || !saText.trim() || undefined} className="btn-primary max-md:tap text-sm aria-disabled:cursor-not-allowed aria-disabled:opacity-50">Check</button>
          </div>
          {saResult !== null && (
            <p className="mt-2 text-[13px] text-muted">
              <span className="font-medium text-ink">Expected: </span>
              {q.modelAnswer}
            </p>
          )}
        </form>
      )}

      {/* Always mounted, so the verdict is announced when it appears. */}
      <div role="status">
        {done && (
          <>
            <p className={`mt-2 text-sm font-semibold ${gotIt ? "text-success" : "text-danger"}`}>{gotIt ? "Correct." : "Not quite."}</p>
            {q.explanation && <p className="mt-1 text-[13px] text-muted">{q.explanation}</p>}
          </>
        )}
      </div>
    </div>
  );
}

/** The text + icon that says which choice was right and which one you picked. */
function AnswerMark({ isAnswer, isPicked }: { isAnswer: boolean; isPicked: boolean }) {
  if (!isAnswer && !isPicked) return null;
  const label = isAnswer && isPicked ? "Your answer, correct" : isAnswer ? "Correct answer" : "Your answer";
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true">
        <path d={isAnswer ? "M5 12.5l4.5 4.5L19 7.5" : "M7 7l10 10M17 7L7 17"} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {label}
    </span>
  );
}
