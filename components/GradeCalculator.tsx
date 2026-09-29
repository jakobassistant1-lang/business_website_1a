"use client";

// The Grades tab on the course page. GRADE CANON (owner, 2026-09-28): the number
// labelled "Current grade" is ALWAYS Canvas's own number and letter — the same one
// GradePill shows (lib/courseGrade) — never this calculator's recomputation. Below
// it sits a "What-if" calculator that STARTS from that number: a "what do I need on
// the rest to hit my target" solver, per-item what-if sliders and a projection,
// plus the weighted-category breakdown. When the teacher hides the course total,
// the headline keeps its honest label, "Estimated from your graded work"
// (lib/gradeCalc.gradeHeadline is the one rule). All math is pure in lib/gradeCalc;
// this is UI + local state. Renders nothing when the course has no point-bearing work.

import { useMemo, useState } from "react";
import { gradedWorkEstimate, gradeHeadline, anchoredProjection, anchoredNeeded, keepUpScores, whatIfOffset, categoryBreakdown, gradeMode, type GradeHeadline, type GradeInput, type NeededResult } from "@/lib/gradeCalc";
import { gradePercentText, type CourseGrade } from "@/lib/courseGrade";
import { toneSoft } from "@/lib/tone";

// The standard letter scale — stated on screen under the picker, since a course's
// own cutoffs can differ.
const TARGETS = [
  { label: "A (93%)", value: 93 },
  { label: "A− (90%)", value: 90 },
  { label: "B+ (87%)", value: 87 },
  { label: "B (83%)", value: 83 },
  { label: "C (73%)", value: 73 },
];

export function GradeCalculator({ items, official }: { items: GradeInput[]; official?: CourseGrade }) {
  const gradeables = useMemo(() => items.filter((i) => i.pointsPossible > 0), [items]);
  const remaining = useMemo(() => gradeables.filter((i) => i.score == null), [gradeables]);
  const mode = gradeMode(gradeables);
  const estimate = gradedWorkEstimate(gradeables);
  const head = gradeHeadline(official, estimate);
  // Anchor (lib/gradeCalc.whatIfOffset): every what-if figure is shifted by
  // Canvas's number minus our estimate, so the untouched what-if IS Canvas's number.
  const offset = whatIfOffset(official, estimate);

  // Default to the NEAREST target above where the student stands now (the next
  // achievable bump), not the highest. TARGETS is descending, so reverse it.
  const defaultTarget = useMemo(() => {
    if (head.start == null) return 90;
    return ([...TARGETS].reverse().find((t) => t.value > head.start!) ?? TARGETS[0]).value;
  }, [head.start]);
  const [target, setTarget] = useState(defaultTarget);
  // The what-if starts from the headline number ("keep it up"): each slider opens
  // at its category's current average, which reproduces today's grade exactly.
  const startPct = Math.round(head.start ?? 85);
  const seeds = useMemo(() => keepUpScores(gradeables), [gradeables]);
  const seedOf = (id: number) => seeds.get(id) ?? startPct;
  const [assume, setAssume] = useState<Map<number, number>>(() => new Map(remaining.map((r) => [r.canvasId, seedOf(r.canvasId)])));
  const [showWhatIf, setShowWhatIf] = useState(false); // per-item sliders collapsed by default — the headline answer leads

  if (gradeables.length === 0) return null;

  const projected = anchoredProjection(gradeables, assume, offset);
  const needed = anchoredNeeded(gradeables, target, offset);
  const need = neededView(needed, remaining.length); // ONE reading, shared by the phone tile + the desktop line
  const targetLetter = (TARGETS.find((t) => t.value === target)?.label ?? `${target}%`).split(" ")[0];
  const cats = mode === "weighted" ? categoryBreakdown(gradeables).filter((c) => c.weight && c.weight > 0) : [];
  const setScore = (id: number, v: number) => setAssume((m) => new Map(m).set(id, v));
  const values = remaining.map((r) => assume.get(r.canvasId) ?? seedOf(r.canvasId));
  const untouched = remaining.every((r) => (assume.get(r.canvasId) ?? seedOf(r.canvasId)) === seedOf(r.canvasId));
  const uniform = values.length > 0 && values.every((v) => v === values[0]) ? Math.round(values[0]) : null;
  const projectionLabel = untouched ? "If you keep up your current averages" : uniform != null ? `If you score ${uniform}% on everything left` : "With the scores you set above";

  return (
    <section data-tour="grade-calculator" className="card mt-6 p-5">
      {/* The headline: Canvas's number (or the honestly-labelled estimate). Phones
          lead with two tiles — where you stand, and what the target below asks of
          the rest; md+ shows the same headline as one row. Both read `head`. */}
      <div className="grid grid-cols-2 gap-3 md:hidden">
        <div className="rounded-lg bg-surface-soft p-3.5">
          <p className="text-[13px] font-medium text-muted">{head.label}</p>
          <p className="mt-1 text-[30px] font-bold leading-none tabular-nums text-ink">{head.value}</p>
          <p className="mt-1.5 text-[14px] text-muted">
            {head.letter && <span className="mr-1.5 font-semibold text-ink">{head.letter}</span>}
            {head.note}
          </p>
        </div>
        <div className="rounded-lg bg-surface-soft p-3.5">
          <p className="text-[13px] font-medium text-muted">What-if: needed for {targetLetter}</p>
          <p className={`mt-1 font-bold leading-none tabular-nums text-ink ${/^\d/.test(need.big) ? "text-[30px]" : "text-[22px]"}`}>{need.big}</p>
          {need.chip ? (
            <span className={`mt-1.5 inline-block rounded-md px-2 py-0.5 text-[13px] font-medium ${CHIP[need.tone]}`}>{need.chip}</span>
          ) : (
            <p className="mt-1.5 text-[14px] text-muted">Nothing left</p>
          )}
        </div>
      </div>
      <Headline head={head} />

      <div className="mt-5 flex items-center gap-2 border-t border-line-subtle pt-4">
        <CalcIcon />
        <h2 className="text-[16px] font-semibold text-ink">What-if</h2>
      </div>
      <p className="mt-1 text-[14px] text-muted">Starts from {head.start != null ? gradePercentText(head.start) : "your grade"}. Try scores on what&rsquo;s left and see where you&rsquo;d finish.</p>

      <div className="mt-4 rounded-lg bg-surface-soft p-4">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="grade-target" className="text-[14px] text-muted">
            I want to finish with
          </label>
          <select
            id="grade-target"
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
            className="max-md:tap rounded-md border border-line bg-surface px-3 py-2 text-[14px] font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {TARGETS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <p className="mt-1.5 text-[13px] text-muted">Targets use the standard scale: A 93, A− 90, B+ 87, B 83, C 73.</p>
        <div className="hidden md:block">
          <NeededLine view={need} />
        </div>
        {/* Phones: the number is in the tile above; keep the plain-English reading. */}
        <p className="mt-2 text-[14px] text-muted md:hidden">{need.big === "—" ? need.suffix : `${need.big} — ${need.suffix}`}</p>
      </div>

      {remaining.length > 0 ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowWhatIf((v) => !v)}
            aria-expanded={showWhatIf}
            className="max-md:tap flex items-center gap-1.5 text-[13px] font-semibold text-muted transition-colors hover:text-accent max-md:text-[15px]"
          >
            <span className={`text-[10px] transition-transform ${showWhatIf ? "rotate-90" : ""}`} aria-hidden>
              ▶
            </span>
            Adjust individual scores ({remaining.length})
          </button>
          {showWhatIf && (
            <div className="mt-3 flex flex-col gap-3">
              {remaining.map((r) => (
                <div key={r.canvasId} className="flex flex-wrap items-center gap-x-3 md:flex-nowrap">
                  <span className="min-w-0 flex-1 basis-full truncate text-[14px] text-ink md:basis-0">
                    {r.name}
                    {mode === "weighted" && r.groupName ? <span className="text-[12px] text-muted"> &middot; {r.groupName}</span> : null}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(assume.get(r.canvasId) ?? seedOf(r.canvasId))}
                    onChange={(e) => setScore(r.canvasId, Number(e.target.value))}
                    aria-label={`${r.name} what-if score`}
                    className="flex-[1.2] accent-accent max-md:h-11"
                  />
                  <span className="w-[44px] shrink-0 text-right text-[14px] font-medium tabular-nums text-ink">{Math.round(assume.get(r.canvasId) ?? seedOf(r.canvasId))}%</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-line-subtle pt-4">
            <span className="text-[14px] text-muted">{projectionLabel}</span>
            <span className="text-[26px] font-bold tabular-nums text-ink">{projected != null ? gradePercentText(projected) : "—"}</span>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-[14px] text-muted">All your work is graded, so nothing left can change this grade.</p>
      )}

      {cats.length > 0 && (
        <div className="mt-4 border-t border-line-subtle pt-4">
          <p className="text-[13px] font-semibold text-muted">Weighted breakdown</p>
          <div className="mt-2 flex flex-col gap-2.5">
            {cats.map((c) => (
              // Phones: name | weight | average on one line, the bar on its own
              // full-width line below. md+: the original four fixed columns.
              <div key={c.groupId ?? c.name} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1.5 md:grid-cols-[120px_34px_minmax(0,1fr)_44px]">
                <span className="min-w-0 truncate text-[13px] text-ink max-md:text-[14px]">{c.name}</span>
                <span className="text-[12px] tabular-nums text-muted max-md:text-[13px]">{Math.round(c.weight!)}%</span>
                <div className="order-last col-span-3 h-2 overflow-hidden rounded-full bg-surface-soft md:order-none md:col-span-1">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${c.average != null ? Math.round(c.average) : 0}%` }} />
                </div>
                <span className="text-right text-[13px] font-medium tabular-nums text-ink max-md:text-[14px]">{c.average != null ? `${Math.round(c.average)}%` : "—"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* What the calculator does, stated plainly — and why a what-if can land a
          little off Canvas's own number. */}
      <p className="mt-4 flex gap-2 text-[13px] leading-snug text-muted">
        <InfoIcon />
        <span>
          {mode === "weighted" ? "What-ifs use your Canvas category weights and each assignment’s points." : "What-ifs add up points across all your work; this course has no category weights in Canvas."}{" "}
          {offset !== 0
            ? "They’re lined up with Canvas’s number, which can also count dropped low scores, extra credit and excused work."
            : "Canvas’s own number can also count dropped low scores, extra credit and excused work."}
        </span>
      </p>
    </section>
  );
}

/** md+ headline row — the same reading as the phone tile. */
function Headline({ head }: { head: GradeHeadline }) {
  return (
    <div className="hidden items-baseline justify-between gap-4 md:flex">
      <div>
        <p className="text-[14px] font-medium text-muted">{head.label}</p>
        <p className="mt-0.5 text-[13px] text-muted">{head.note}</p>
      </div>
      <p className="shrink-0">
        <span className="text-[30px] font-bold leading-none tabular-nums text-ink">{head.value}</span>
        {head.letter && <span className="ml-2 text-[16px] font-semibold text-muted">{head.letter}</span>}
      </p>
    </div>
  );
}

type NeededView = { big: string; tone: keyof typeof CHIP; chip: string | null; suffix: string };

/** How the "what do I need" answer reads — the one mapping from the solver's
 *  result to words, shared by the phone stat tile and the desktop line. */
function neededView(needed: NeededResult, remainingCount: number): NeededView {
  if (remainingCount === 0) return { big: "—", tone: "accent", chip: null, suffix: "No remaining work can change this grade." };
  if (needed.kind === "secured") return { big: "Locked in", tone: "success", chip: "Already secured", suffix: "even a zero on everything left keeps your target." };
  if (needed.kind === "impossible") return { big: "Out of reach", tone: "danger", chip: "Not this term", suffix: "even 100% on everything left falls short of this." };
  const tone = needed.value <= 80 ? "success" : needed.value <= 92 ? "accent" : "warning";
  const chip = needed.value <= 80 ? "Comfortable" : needed.value <= 92 ? "Within reach" : "Very tough";
  return { big: `${needed.value}%`, tone, chip, suffix: "average on each remaining item." };
}

function NeededLine({ view }: { view: NeededView }) {
  if (view.chip == null) return <p className="mt-3 text-[14px] text-muted">{view.suffix}</p>;
  return <Result big={view.big} tone={view.tone} chip={view.chip} suffix={view.suffix} />;
}

const CHIP: Record<"success" | "danger" | "warning" | "accent", string> = {
  success: toneSoft.success,
  danger: toneSoft.danger,
  warning: toneSoft.warning,
  accent: "bg-accent-soft text-ink",
};

function Result({ big, tone, chip, suffix }: { big: string; tone: keyof typeof CHIP; chip: string; suffix: string }) {
  return (
    <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="text-[14px] text-muted">You&rsquo;d need about</span>
      <span className="text-[24px] font-bold tabular-nums text-ink">{big}</span>
      <span className={`rounded-md px-2 py-0.5 text-[12px] font-medium ${CHIP[tone]}`}>{chip}</span>
      <span className="w-full text-[13px] text-muted">{suffix}</span>
    </div>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" className="mt-px h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8v.01" />
    </svg>
  );
}

function CalcIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] text-accent" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M8 6h8M8 10h2m4 0h2M8 14h2m4 0h2M8 18h2m4 0h2" />
    </svg>
  );
}
