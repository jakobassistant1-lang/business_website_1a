"use client";

// Grade calculator on the course page — the answers Canvas hides: a "what do I
// need on the rest to hit my target" solver, a live what-if simulator, and a
// weighted-category breakdown. All math lives in lib/gradeCalc (pure + tested);
// this is just UI + local state. Renders nothing when the course has no
// point-bearing work to reason about.

import { useMemo, useState } from "react";
import { currentGrade, projectGrade, neededUniformScore, categoryBreakdown, gradeMode, type GradeInput, type NeededResult } from "@/lib/gradeCalc";
import { toneSoft } from "@/lib/tone";
import type { CourseGrade } from "@/lib/courseGrade";

const TARGETS = [
  { label: "A (93%)", value: 93 },
  { label: "A− (90%)", value: 90 },
  { label: "B+ (87%)", value: 87 },
  { label: "B (83%)", value: 83 },
  { label: "C (73%)", value: 73 },
];

function letterFor(p: number): string {
  if (p >= 93) return "A";
  if (p >= 90) return "A−";
  if (p >= 87) return "B+";
  if (p >= 83) return "B";
  if (p >= 80) return "B−";
  if (p >= 77) return "C+";
  if (p >= 73) return "C";
  if (p >= 70) return "C−";
  if (p >= 60) return "D";
  return "F";
}

export function GradeCalculator({ items, official }: { items: GradeInput[]; official?: CourseGrade }) {
  const gradeables = useMemo(() => items.filter((i) => i.pointsPossible > 0), [items]);
  const remaining = useMemo(() => gradeables.filter((i) => i.score == null), [gradeables]);
  const mode = gradeMode(gradeables);
  const cur = currentGrade(gradeables);

  // Default to the NEAREST grade above the current one (the next achievable bump),
  // not the highest. TARGETS is descending, so reverse to find the lowest one above.
  const defaultTarget = useMemo(() => {
    if (cur == null) return 90;
    return ([...TARGETS].reverse().find((t) => t.value > cur) ?? TARGETS[0]).value;
  }, [cur]);
  const [target, setTarget] = useState(defaultTarget);
  const [assume, setAssume] = useState<Map<number, number>>(() => new Map(remaining.map((r) => [r.canvasId, 85])));

  if (gradeables.length === 0) return null;

  const projected = projectGrade(gradeables, assume);
  const needed = neededUniformScore(gradeables, target);
  const cats = mode === "weighted" ? categoryBreakdown(gradeables).filter((c) => c.weight && c.weight > 0) : [];
  const setScore = (id: number, v: number) => setAssume((m) => new Map(m).set(id, v));

  return (
    <section data-tour="grade-calculator" className="card mt-6 p-5">
      <div className="flex items-center gap-2">
        <CalcIcon />
        <h2 className="text-[16px] font-semibold text-ink">Grade calculator</h2>
      </div>

      <div className="mt-4 rounded-lg bg-surface-soft p-4">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="grade-target" className="text-[14px] text-muted">
            I want to finish with
          </label>
          <select
            id="grade-target"
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
            className="rounded-md border border-line bg-surface px-2 py-1 text-[14px] font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
          >
            {TARGETS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <NeededLine needed={needed} remainingCount={remaining.length} />
      </div>

      {remaining.length > 0 ? (
        <div className="mt-4">
          <p className="text-[13px] font-semibold text-muted">What if I score&hellip;</p>
          <div className="mt-2 flex flex-col gap-3">
            {remaining.map((r) => (
              <div key={r.canvasId} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-[14px] text-ink">
                  {r.name}
                  {mode === "weighted" && r.groupName ? <span className="text-[12px] text-muted"> &middot; {r.groupName}</span> : null}
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={assume.get(r.canvasId) ?? 85}
                  onChange={(e) => setScore(r.canvasId, Number(e.target.value))}
                  aria-label={`${r.name} hypothetical score`}
                  className="flex-[1.2]"
                  style={{ accentColor: "rgb(var(--accent))" }}
                />
                <span className="w-[44px] shrink-0 text-right text-[14px] font-medium tabular-nums text-ink">{assume.get(r.canvasId) ?? 85}%</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-[14px] text-muted">All your work is graded — this grade is locked in for the term.</p>
      )}

      <div className="mt-4 flex items-baseline justify-between border-t border-line-subtle pt-4">
        <span className="text-[14px] text-muted">{remaining.length > 0 ? "Projected final grade" : "Current grade"}</span>
        <span>
          <span className="text-[26px] font-bold tabular-nums text-ink">{projected != null ? `${Math.round(projected)}%` : "—"}</span>
          {projected != null && <span className="ml-1.5 text-[14px] font-medium text-accent">{letterFor(projected)}</span>}
        </span>
      </div>

      {cats.length > 0 && (
        <div className="mt-4 border-t border-line-subtle pt-4">
          <p className="text-[13px] font-semibold text-muted">Weighted breakdown</p>
          <div className="mt-2 flex flex-col gap-2.5">
            {cats.map((c) => (
              <div key={c.groupId ?? c.name} className="flex items-center gap-3">
                <span className="w-[120px] shrink-0 truncate text-[13px] text-ink">{c.name}</span>
                <span className="w-[34px] shrink-0 text-[12px] tabular-nums text-muted">{Math.round(c.weight!)}%</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-soft">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${c.average != null ? Math.round(c.average) : 0}%` }} />
                </div>
                <span className="w-[44px] shrink-0 text-right text-[13px] font-medium tabular-nums text-ink">{c.average != null ? `${Math.round(c.average)}%` : "—"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-4 text-[12px] text-muted">
        {mode === "weighted" ? "Estimated from your Canvas category weights." : "Based on raw points — your course may weight categories differently."}
        {official?.state === "graded" && official.score != null ? ` Your official Canvas grade is ${Math.round(official.score)}%.` : ""}
      </p>
    </section>
  );
}

function NeededLine({ needed, remainingCount }: { needed: NeededResult; remainingCount: number }) {
  if (remainingCount === 0) {
    return <p className="mt-3 text-[14px] text-muted">No remaining work can change this grade.</p>;
  }
  if (needed.kind === "secured") {
    return <Result big="Locked in" tone="success" chip="Already secured" suffix="even a zero on everything left keeps your target." />;
  }
  if (needed.kind === "impossible") {
    return <Result big="Out of reach" tone="danger" chip="Not this term" suffix="even 100% on everything left falls short of this." />;
  }
  const tone = needed.value <= 80 ? "success" : needed.value <= 92 ? "accent" : "warning";
  const chip = needed.value <= 80 ? "Comfortable" : needed.value <= 92 ? "Within reach" : "Very tough";
  return <Result big={`${needed.value}%`} tone={tone} chip={chip} suffix="average on each remaining item." />;
}

const CHIP: Record<"success" | "danger" | "warning" | "accent", string> = {
  success: toneSoft.success,
  danger: toneSoft.danger,
  warning: toneSoft.warning,
  accent: "bg-accent-soft text-accent",
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

function CalcIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] text-accent" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M8 6h8M8 10h2m4 0h2M8 14h2m4 0h2M8 18h2m4 0h2" />
    </svg>
  );
}
