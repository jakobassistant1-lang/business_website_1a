"use client";

// Demo-only illustration of the per-test study tools the app auto-builds from a
// test's Canvas notes & readings (a study guide + practice questions). Static
// sample content for the demo's "Science · Midterm Exam" — not the real
// generator (lib/study), just a faithful preview so the demo can show off the
// feature without an AI/Canvas round-trip.

import { useState } from "react";

const SOURCES = ["Chapter 6 reading.pdf", "Lecture 5 notes", "Cell lab handout"];

const GUIDE = [
  { topic: "Cells & organelles", points: ["What each organelle does", "How the membrane moves things in & out"] },
  { topic: "Energy & metabolism", points: ["Photosynthesis vs. respiration", "Where ATP comes from"] },
  { topic: "Genetics basics", points: ["DNA → RNA → protein", "Dominant vs. recessive traits"] },
];
const TERMS = ["Mitochondria", "ATP", "Osmosis", "Allele", "Phenotype"];
const QUESTION = {
  prompt: "Which organelle produces most of the cell's ATP?",
  options: ["Nucleus", "Mitochondria", "Ribosome", "Golgi apparatus"],
  answer: 1,
};

export function DemoStudyTools() {
  const [picked, setPicked] = useState<number | null>(null);

  // First pick reveals the answer and — after a beat to read the feedback —
  // signals the tour to advance (this is the action-gated step). Re-picks don't
  // re-fire; in explore mode no tour is listening, so it just shows feedback.
  const onPick = (i: number) => {
    const first = picked === null;
    setPicked(i);
    if (first) window.setTimeout(() => window.dispatchEvent(new CustomEvent("sp:demo-answered")), 650);
  };

  const optionClass = (i: number) => {
    if (picked === null) return "border-line hover:border-accent hover:bg-accent-soft/40";
    if (i === QUESTION.answer) return "border-success bg-success-soft";
    if (i === picked) return "border-danger bg-danger-soft";
    return "border-line opacity-60";
  };

  return (
    <div data-tour="study-tools" className="mt-6">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="font-semibold uppercase tracking-wide text-accent">Auto-built</span>
        <span>from your Canvas:</span>
        {SOURCES.map((s) => (
          <span key={s} className="rounded-full bg-surface-soft px-2 py-0.5">{s}</span>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Study guide */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-ink">Study guide</h3>
          <div className="mt-3 space-y-3">
            {GUIDE.map((g) => (
              <div key={g.topic}>
                <p className="text-[13px] font-semibold text-ink">{g.topic}</p>
                <ul className="mt-1 space-y-0.5">
                  {g.points.map((p) => (
                    <li key={p} className="flex gap-1.5 text-[13px] text-muted">
                      <span className="text-accent">•</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {TERMS.map((t) => (
              <span key={t} className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">{t}</span>
            ))}
          </div>
        </div>

        {/* Practice question */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-ink">Practice question</h3>
          <p className="mt-3 text-[14px] font-medium text-ink">{QUESTION.prompt}</p>
          <div className="mt-3 space-y-2">
            {QUESTION.options.map((o, i) => (
              <button
                key={o}
                type="button"
                onClick={() => onPick(i)}
                className={`block w-full rounded-lg border px-3 py-2 text-left text-[13px] text-ink transition-[border-color,background-color,transform] duration-150 ease-out active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 motion-reduce:transition-none ${optionClass(i)}`}
              >
                {o}
              </button>
            ))}
          </div>
          <p className="mt-3 min-h-[1rem] text-xs font-medium">
            {picked === null ? (
              <span className="text-faint">Pick an answer</span>
            ) : picked === QUESTION.answer ? (
              <span className="text-success">Correct — mitochondria are the cell&apos;s power plants.</span>
            ) : (
              <span className="text-danger">Not quite — the answer is Mitochondria.</span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
