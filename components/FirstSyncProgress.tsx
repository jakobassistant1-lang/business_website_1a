"use client";

// The first-run wait, made visible (#64). Runs the sync → AI analysis → plan
// pipeline the moment Canvas connects and narrates each stage, then lands on
// the ready dashboard. Kills the old silent 10-30s blank-dashboard gap at the
// exact moment a new trial user decides whether Navo works. Analysis drains in
// bounded rounds so the first plan is fully ranked on arrival (first-run half
// of #129). Failure paths stay honest: sync errors show guidance + retry; AI
// errors don't block (the plan renders with defaults — fail-open by design).
import { useEffect, useRef, useState } from "react";
import { MAX_ANALYZE_ROUNDS, shouldContinue, type AnalyzeRoundResponse } from "@/lib/analysisLoop";

type Stage = "sync" | "analyze" | "plan";
const LABELS: Record<Stage, string> = {
  sync: "Pulling in your courses and assignments",
  analyze: "Reading your assignments",
  plan: "Building your plan",
};
const ORDER: Stage[] = ["sync", "analyze", "plan"];
// The cap AND the stop rule live in lib/analysisLoop (#129) — one rule, two call
// sites (here and useAutoSync). This loop is the first-run one: no pause between
// rounds (the user is watching a spinner) and no refresh at the end (it hard-
// navigates to the dashboard instead).

export function FirstSyncProgress() {
  const [stage, setStage] = useState<Stage>("sync");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const running = useRef(false);

  useEffect(() => {
    if (running.current) return;
    running.current = true;
    let cancelled = false;

    (async () => {
      setError(null);
      setStage("sync");
      try {
        const sync = await fetch("/api/sync", { method: "POST" }).then((r) => r.json());
        if (cancelled) return;
        if (!sync?.ok) {
          setError(sync?.message ?? "We couldn't reach your school's Canvas. Check the token and try again.");
          running.current = false;
          return;
        }
        setStage("analyze");
        for (let i = 0; i < MAX_ANALYZE_ROUNDS; i++) {
          const a: AnalyzeRoundResponse | null = await fetch("/api/analyze", { method: "POST" })
            .then((r) => r.json())
            .catch(() => null);
          if (cancelled) return;
          if (!shouldContinue(i, a)) break; // done / nothing analyzed / AI unavailable → fail open
        }
        setStage("plan");
        // The dashboard auto-syncs once per browser session — we just did that
        // work, so set its guard (same key) and land on a ready, ranked plan.
        window.location.href = "/dashboard?welcome=1";
      } catch {
        if (!cancelled) {
          setError("Something interrupted the first sync. Your connection is saved — retry when ready.");
          running.current = false;
        }
      }
    })();
    return () => { cancelled = true; };
  }, [attempt]);

  const stageIdx = ORDER.indexOf(stage);
  return (
    <div className="mt-4">
      {ORDER.map((s, i) => (
        <p key={s} className={`flex items-center gap-2.5 py-1 text-[14.5px] ${i < stageIdx ? "text-muted" : i === stageIdx ? "font-medium text-ink" : "text-faint"}`}>
          {i < stageIdx ? (
            <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-success" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 8.5 6.5 12 13 4.5" /></svg>
          ) : i === stageIdx && !error ? (
            <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-line border-t-accent" aria-hidden />
          ) : (
            <span className="h-4 w-4 shrink-0 rounded-full border-2 border-line" aria-hidden />
          )}
          {LABELS[s]}
          {i === stageIdx && !error ? "…" : ""}
        </p>
      ))}
      {error && (
        <div className="mt-3 rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">
          <p>{error}</p>
          <div className="mt-2 flex items-center gap-3">
            <button type="button" onClick={() => setAttempt((a) => a + 1)} className="font-medium underline-offset-2 hover:underline">
              Try again
            </button>
            <a href="/dashboard" className="font-medium underline-offset-2 hover:underline">
              Go to your plan anyway →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
