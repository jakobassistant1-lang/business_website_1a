"use client";

// The Study page — prepare for one upcoming test/quiz. Featured card = the next
// assessment per the EXISTING recommended order (same ranked list the dashboard
// uses), styled like the dashboard's violet Focus module; other tests in rows.
// For the focused test: (1) the how-to-study layer mapped onto the scheduler's
// existing blocks, (2) the AI study guide, (3) interactive practice questions.
// Plan + guide auto-load (server-cached, so repeat visits cost no model calls);
// questions generate on demand in the student's chosen type.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fmtHours, fmtTime } from "@/components/calendar/parts";
import { parseYmd, WEEKDAYS, MONTHS_SHORT } from "@/lib/calendarDates";
import { round1 } from "@/lib/round";
import { toneSoft } from "@/lib/tone";
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
import type { ItemType } from "@/lib/itemType";

const TYPE_LABEL: Record<ItemType, string> = { assignment: "Assignment", quiz: "Quiz", exam: "Exam", other: "Task" };
const shortCourse = (name: string) => name.split(" · ")[0];

function dueLabel(iso: string): string {
  const d = new Date(iso);
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()} · ${fmtTime(iso)}`;
}
function sessionDateLabel(ymdStr: string): string {
  const d = parseYmd(ymdStr);
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

type Gen<T> = { status: "idle" | "loading" | "ready" | "error"; content: T | null; error: string | null };
const IDLE: Gen<never> = { status: "idle", content: null, error: null };

async function postStudy<T>(body: Record<string, unknown>): Promise<{ ok: true; content: T } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/study", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json?.ok) return { ok: true, content: json.content as T };
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

export function StudyView({
  connected,
  assessments,
  sessions,
  initialFocusId,
}: {
  connected: boolean;
  assessments: CalendarItem[];
  sessions: Record<number, { date: string; hours: number }[]>;
  initialFocusId: number | null;
  todayYmd: string;
}) {
  const router = useRouter();
  const [focusId, setFocusId] = useState<number | null>(initialFocusId);
  const focus = assessments.find((a) => a.canvasId === focusId) ?? null;

  const [plan, setPlan] = useState<Gen<StudyPlanContent>>(IDLE);
  const [guide, setGuide] = useState<Gen<StudyGuideContent>>(IDLE);
  const [qType, setQType] = useState<StudyQuestionType>("multiple_choice");
  const [questions, setQuestions] = useState<Gen<StudyQuestionsContent>>(IDLE);
  const [setId, setSetId] = useState(0); // remounts the interactive list per new set
  const reqSeq = useRef(0); // ignore stale responses after a focus switch

  const load = useCallback(
    async (kind: "plan" | "guide" | "questions", id: number, opts?: { force?: boolean; questionType?: StudyQuestionType }) => {
      const seq = ++reqSeq.current;
      const set = kind === "plan" ? setPlan : kind === "guide" ? setGuide : setQuestions;
      set({ status: "loading", content: null, error: null });
      const res = await postStudy<never>({ canvasId: id, kind, force: opts?.force, questionType: opts?.questionType });
      if (seq < reqSeq.current && kind !== "questions") return; // a newer focus took over
      if (res.ok) {
        set({ status: "ready", content: res.content, error: null });
        if (kind === "questions") setSetId((n) => n + 1);
      } else {
        set({ status: "error", content: null, error: res.error });
      }
    },
    [],
  );

  // Plan + guide auto-load for the focused test (server cache → usually instant).
  useEffect(() => {
    if (focusId === null || !connected) return;
    setQuestions(IDLE);
    void load("plan", focusId);
    void load("guide", focusId);
  }, [focusId, connected, load]);

  function focusOn(id: number) {
    setFocusId(id);
    router.replace(`/study?item=${id}`, { scroll: false });
  }

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

  if (assessments.length === 0 || !focus) {
    return (
      <div className="mx-auto max-w-xl">
        <div className="card p-10 text-center">
          <p className="text-base font-medium text-ink">No upcoming tests or quizzes.</p>
          <p className="mt-1.5 text-sm text-muted">When one lands on your calendar, it&apos;ll show up here with a study plan ready to go.</p>
          <Link href="/calendar" className="btn-primary mt-5">Open calendar</Link>
        </div>
      </div>
    );
  }

  const focusSessions = sessions[focus.canvasId] ?? [];
  const totalHours = round1(focusSessions.reduce((s, x) => s + x.hours, 0));
  const others = assessments.filter((a) => a.canvasId !== focus.canvasId);
  const isNextUp = assessments[0]?.canvasId === focus.canvasId;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <p className="text-xl font-semibold text-ink">Study</p>
        <p className="mt-0.5 text-sm text-muted">Get ready for what&apos;s coming — plan, guide, and practice for each test.</p>
      </div>

      {/* Featured test — the dashboard's violet hero treatment */}
      <div className="rounded-xl bg-accent p-7 text-white shadow-card">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-white/80">{isNextUp ? "Next up" : "Studying for"}</p>
        <p className="mt-1.5 block text-[2rem] font-bold leading-[1.1] tracking-tight">{focus.name}</p>
        <p className="mt-1 text-[15px] text-white/80">
          {TYPE_LABEL[focus.type]} · {shortCourse(focus.courseName)}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {focus.dueAt && <Chip text={`Due ${dueLabel(focus.dueAt)}`} />}
          {focus.pointsPossible != null && focus.pointsPossible > 0 && <Chip text={`${focus.pointsPossible} pts`} />}
          <Chip text={focusSessions.length > 0 ? `${fmtHours(totalHours)} of study scheduled` : "No study blocks scheduled"} />
        </div>
        {focus.htmlUrl && (
          <a href={focus.htmlUrl} target="_blank" rel="noreferrer" className="mt-5 inline-block rounded-[14px] border border-white/40 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-white/10">
            Open in Canvas ↗
          </a>
        )}
      </div>

      <div className="mt-6 space-y-6">
        <PlanSection plan={plan} sessions={focusSessions} onRetry={() => load("plan", focus.canvasId)} onRegen={() => load("plan", focus.canvasId, { force: true })} />
        <GuideSection guide={guide} onRetry={() => load("guide", focus.canvasId)} onRegen={() => load("guide", focus.canvasId, { force: true })} />
        <QuestionsSection
          questions={questions}
          qType={qType}
          setQType={setQType}
          setKey={setId}
          onGenerate={(force) => load("questions", focus.canvasId, { force, questionType: qType })}
        />
      </div>

      {others.length > 0 && (
        <div className="card mt-6 p-6">
          <h2 className="text-lg font-semibold text-ink">Also coming up</h2>
          <div className="mt-2 divide-y divide-line-subtle/70">
            {others.map((a) => (
              <button key={a.canvasId} onClick={() => focusOn(a.canvasId)} className="flex w-full items-center gap-3.5 px-1 py-3.5 text-left transition-colors hover:bg-surface-soft">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-ink">{a.name}</span>
                  <span className="block truncate text-[13px] text-muted">
                    {TYPE_LABEL[a.type]} · {shortCourse(a.courseName)}
                  </span>
                </span>
                {a.dueAt && <span className="shrink-0 text-[13px] font-medium text-ink">{dueLabel(a.dueAt)}</span>}
                <span className="shrink-0 text-sm font-medium text-accent">Study →</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({ text }: { text: string }) {
  return <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium text-white ring-1 ring-inset ring-white/25">{text}</span>;
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
      <p className="pt-1 text-xs text-muted">Generating with AI — a few seconds…</p>
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

function SourceNote({ sparse, sources }: { sparse: boolean; sources: string[] }) {
  if (sparse) {
    return (
      <p className={`mt-4 inline-block rounded-full px-2.5 py-1 text-xs font-medium ${toneSoft.warning}`}>
        Limited Canvas material — generated from the test&apos;s own info. Check with your teacher on exact coverage.
      </p>
    );
  }
  if (sources.length === 0) return null;
  return <p className="mt-4 text-xs text-muted">Based on: {sources.slice(0, 5).join(" · ")}{sources.length > 5 ? " · …" : ""}</p>;
}

// ---------- 1) How to study (the AI layer on the deterministic blocks) ----------

function PlanSection({
  plan,
  sessions,
  onRetry,
  onRegen,
}: {
  plan: Gen<StudyPlanContent>;
  sessions: { date: string; hours: number }[];
  onRetry: () => void;
  onRegen: () => void;
}) {
  const header =
    sessions.length > 0
      ? `Your plan reserves ${sessions.length} session${sessions.length === 1 ? "" : "s"} · ${fmtHours(round1(sessions.reduce((s, x) => s + x.hours, 0)))} total before the test.`
      : "No study blocks are scheduled before this test — here's how to use the time you have.";

  return (
    <SectionShell title="How to study this" aside={plan.status === "ready" ? <RegenButton onClick={onRegen} /> : undefined}>
      <p className="text-sm text-muted">{header}</p>
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

// ---------- 2) Study guide ----------

function GuideSection({ guide, onRetry, onRegen }: { guide: Gen<StudyGuideContent>; onRetry: () => void; onRegen: () => void }) {
  return (
    <SectionShell title="Study guide" aside={guide.status === "ready" ? <RegenButton onClick={onRegen} /> : undefined}>
      {guide.status === "loading" && <Skeleton lines={6} />}
      {guide.status === "error" && <ErrorBox code={guide.error} onRetry={onRetry} />}
      {guide.status === "ready" && guide.content && (
        <>
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
          <SourceNote sparse={guide.content.sparse} sources={guide.content.sources} />
        </>
      )}
    </SectionShell>
  );
}

// ---------- 3) Interactive practice questions ----------

function QuestionsSection({
  questions,
  qType,
  setQType,
  setKey,
  onGenerate,
}: {
  questions: Gen<StudyQuestionsContent>;
  qType: StudyQuestionType;
  setQType: (t: StudyQuestionType) => void;
  setKey: number;
  onGenerate: (force: boolean) => void;
}) {
  const [results, setResults] = useState<Record<number, boolean>>({});
  useEffect(() => setResults({}), [setKey]); // new set → clear the score
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
            {questions.content!.questions.map((q, i) => (
              <QuestionCard key={i} q={q} index={i} onResult={(ok) => setResults((r) => ({ ...r, [i]: ok }))} />
            ))}
            {answered === questions.content!.questions.length && (
              <p className="rounded-[14px] bg-accent-soft px-4 py-3 text-sm font-semibold text-accent">
                {correct} / {questions.content!.questions.length} correct{correct === questions.content!.questions.length ? " — you're ready for this one." : " — review the explanations above, then try a new set."}
              </p>
            )}
            <SourceNote sparse={questions.content!.sparse} sources={[]} />
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
