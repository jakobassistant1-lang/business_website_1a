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

import { useCallback, useEffect, useState } from "react";
import { useRef } from "react";
import Link from "next/link";
import { fmtHours, StudyLeadEditor } from "@/components/calendar/parts";
import { round1 } from "@/lib/round";
import { toneSoft } from "@/lib/tone";
import { TYPE_LABEL, shortCourse, dueLabel, sessionDateLabel, StudyChip } from "@/components/studyUi";
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
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json?.ok) return { ok: true, content: json.content as T, cached: json.cached === true };
    return { ok: false, error: typeof json?.error === "string" ? json.error : "failed" };
  } catch {
    return { ok: false, error: "network" };
  }
}

const ERROR_TEXT: Record<string, string> = {
  no_key: "The AI service isn't configured.",
  timeout: "Generation took too long.",
  not_connected: "Connect your Canvas account first.",
  network: "Couldn't reach the server.",
};
const errText = (code: string | null) => (code && ERROR_TEXT[code]) || "Something went wrong generating this.";

export function StudyTools({
  assessment,
  sessions,
  isNextUp,
}: {
  assessment: CalendarItem;
  sessions: { date: string; hours: number }[];
  isNextUp: boolean;
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

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/study" className="text-sm font-medium text-accent hover:underline">
        ← All tests
      </Link>

      {/* Compact test header — same violet language as the hub's hero */}
      <div className="mt-3 rounded-xl bg-accent p-5 text-white shadow-card">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-white/80">{isNextUp ? "Next up" : "Studying for"}</p>
        <p className="mt-1 text-xl font-bold leading-tight tracking-tight sm:text-2xl">{assessment.name}</p>
        <p className="mt-0.5 text-sm text-white/80">
          {TYPE_LABEL[assessment.type]} · {shortCourse(assessment.courseName)}
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {assessment.dueAt && <StudyChip text={`Due ${dueLabel(assessment.dueAt)}`} />}
          {assessment.pointsPossible != null && assessment.pointsPossible > 0 && <StudyChip text={`${assessment.pointsPossible} pts`} />}
          {assessment.htmlUrl && (
            <a href={assessment.htmlUrl} target="_blank" rel="noreferrer" className="ml-auto rounded-full border border-white/40 px-3 py-1 text-xs font-medium text-white transition hover:bg-white/10">
              Open in Canvas ↗
            </a>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-5 inline-flex max-w-full gap-1 overflow-x-auto rounded-full bg-surface-soft p-1" role="tablist" aria-label="Study tools">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition ${
              tab === t.id ? "bg-accent text-white" : "text-muted hover:text-ink"
            }`}
          >
            {t.id === "notes" && noteCount > 0 ? `${t.label} · ${noteCount}` : t.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
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
    <div className="space-y-2.5" aria-label="Generating…">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className={`h-4 animate-pulse rounded-md bg-surface-soft ${i % 3 === 2 ? "w-2/3" : "w-full"}`} />
      ))}
      <p className="pt-1 text-xs text-muted">Generating with AI — usually 5-20 seconds…</p>
    </div>
  );
}

function ErrorBox({ code, onRetry }: { code: string | null; onRetry: () => void }) {
  return (
    <div className="rounded-[14px] border border-danger/30 bg-danger-soft/40 px-4 py-3">
      <p className="text-sm text-danger">{errText(code)}</p>
      <button onClick={onRetry} className="mt-2 text-sm font-medium text-accent hover:underline">Try again</button>
    </div>
  );
}

function RegenButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="shrink-0 text-[13px] font-medium text-muted transition-colors hover:text-accent">
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
          Limited Canvas material — generated from the test&apos;s own info. Check with your teacher on exact coverage.
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
        <p className="text-xs text-faint">
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
      <span>You&apos;ve added or changed notes since this was made. Regenerate to include them.</span>
      <button onClick={onRegen} className="shrink-0 font-semibold hover:underline">
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
      ? `Your plan reserves ${sessions.length} session${sessions.length === 1 ? "" : "s"} · ${fmtHours(totalHours)} total before the test.`
      : "No study blocks are scheduled before this test — here's how to use the time you have.";

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
                        Session {i + 1} · {sessionDateLabel(s.date)}
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
        <select className="field w-auto" value={qType} onChange={(e) => setQType(e.target.value as StudyQuestionType)} aria-label="Question type">
          {QUESTION_TYPES.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <button onClick={() => onGenerate(false)} disabled={questions.status === "loading"} className="btn-primary text-sm">
          {questions.status === "loading" ? "Generating…" : ready ? "Generate (new type)" : "Generate questions"}
        </button>
        {ready && (
          <button onClick={() => onGenerate(true)} className="text-[13px] font-medium text-muted transition-colors hover:text-accent">
            New set
          </button>
        )}
      </div>

      <div className="mt-4">
        {questions.status === "idle" && <p className="text-sm text-muted">Pick a question type and generate a practice set from this test&apos;s material.</p>}
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
                {correct} / {questions.content!.questions.length} correct{correct === questions.content!.questions.length ? " — you're ready for this one." : " — review the explanations above, then try a new set."}
              </p>
            )}
            <SourceNote sparse={questions.content!.sparse} sources={[]} excluded={questions.content!.excluded} noteCount={questions.content!.noteCount} />
          </div>
        )}
      </div>
    </SectionShell>
  );
}

function QuestionCard({ q, index, onResult }: { q: StudyQuestion; index: number; onResult: (ok: boolean) => void }) {
  const [picked, setPicked] = useState<number | boolean | null>(null);
  const [saText, setSaText] = useState("");
  const [saResult, setSaResult] = useState<boolean | null>(null);
  const done = picked !== null || saResult !== null;

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

  const verdict = (ok: boolean) => (
    <p className={`mt-2 text-sm font-semibold ${ok ? "text-success" : "text-danger"}`}>{ok ? "Correct!" : "Not quite."}</p>
  );

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
            const cls = !done
              ? "border-line bg-surface hover:border-accent-ring"
              : isAnswer
                ? "border-success bg-success-soft text-success"
                : isPicked
                  ? "border-danger bg-danger-soft text-danger"
                  : "border-line-subtle bg-surface opacity-60";
            return (
              <button key={i} onClick={() => answerMcq(i)} disabled={done} className={`block w-full rounded-[14px] border px-3.5 py-2 text-left text-sm transition ${cls}`}>
                {c}
              </button>
            );
          })}
        </div>
      )}

      {q.kind === "true_false" && (
        <div className="mt-2.5 flex gap-2">
          {([true, false] as const).map((v) => {
            const isAnswer = v === q.answer;
            const isPicked = picked === v;
            const cls = !done
              ? "border-line bg-surface hover:border-accent-ring"
              : isAnswer
                ? "border-success bg-success-soft text-success"
                : isPicked
                  ? "border-danger bg-danger-soft text-danger"
                  : "border-line-subtle bg-surface opacity-60";
            return (
              <button key={String(v)} onClick={() => answerTf(v)} disabled={done} className={`rounded-[14px] border px-5 py-2 text-sm font-medium transition ${cls}`}>
                {v ? "True" : "False"}
              </button>
            );
          })}
        </div>
      )}

      {q.kind === "short_answer" && (
        <form onSubmit={checkSa} className="mt-2.5">
          <div className="flex gap-2">
            <input className="field flex-1" value={saText} onChange={(e) => setSaText(e.target.value)} placeholder="Type your answer…" disabled={done} />
            <button type="submit" disabled={done || !saText.trim()} className="btn-primary text-sm">Check</button>
          </div>
          {saResult !== null && (
            <p className="mt-2 text-[13px] text-muted">
              <span className="font-medium text-ink">Expected: </span>
              {q.modelAnswer}
            </p>
          )}
        </form>
      )}

      {done && (
        <>
          {verdict(q.kind === "multiple_choice" ? picked === q.answer : q.kind === "true_false" ? picked === q.answer : saResult === true)}
          {q.explanation && <p className="mt-1 text-[13px] text-muted">{q.explanation}</p>}
        </>
      )}
    </div>
  );
}
