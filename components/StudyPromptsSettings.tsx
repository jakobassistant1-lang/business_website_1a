"use client";

// The "Study outputs" group on /admin/ai: one card, three tabs — the editable
// instruction for the study plan, the study guide, and the practice questions.
// Only the coaching/voice half of each prompt is editable; the data blocks and
// JSON output contracts are fixed in code (the parsers depend on them).

import { useState } from "react";

type Kind = "plan" | "guide" | "questions";
const TABS: { id: Kind; label: string }[] = [
  { id: "plan", label: "Study plan" },
  { id: "guide", label: "Study guide" },
  { id: "questions", label: "Practice questions" },
];

interface PromptState {
  prompt: string;
  isCustom: boolean;
}

export function StudyPromptsSettings({
  initial,
  defaults,
}: {
  initial: Record<Kind, PromptState>;
  defaults: Record<Kind, string>;
}) {
  const [tab, setTab] = useState<Kind>("plan");
  const [drafts, setDrafts] = useState<Record<Kind, PromptState>>(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cur = drafts[tab];

  function edit(v: string) {
    setDrafts((d) => ({ ...d, [tab]: { ...d[tab], prompt: v } }));
    if (saved === tab) setSaved(null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/study-prompts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: tab, prompt: cur.prompt }),
    });
    setBusy(false);
    if (res.ok) {
      setSaved(tab);
      setDrafts((d) => ({ ...d, [tab]: { ...d[tab], isCustom: true } }));
    } else {
      const b = await res.json().catch(() => ({}));
      setError(b.error ?? "Couldn't save. Try again.");
    }
  }

  return (
    <section>
      <h2 className="text-lg font-semibold tracking-tight text-ink">Study outputs</h2>
      <p className="mt-1 text-sm text-muted">
        The three generators behind the Study page. The app supplies the test's details, the linked Canvas
        material, and the fixed schedule automatically — these prompts tune the coaching voice and content
        style. Saving one regenerates that artifact on each student&apos;s next visit.{" "}
        {cur.isCustom ? "A custom prompt is active for this tab." : "This tab is using the built-in default."}
      </p>
      <div className="card mt-3 p-6">
        <div className="inline-flex gap-1 rounded-full bg-surface-soft p-1" role="tablist" aria-label="Study prompt">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => {
                setTab(t.id);
                setError(null);
              }}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                tab === t.id ? "bg-accent text-white" : "text-muted hover:text-ink"
              }`}
            >
              {t.label}
              {drafts[t.id].isCustom && <span className="ml-1.5 align-middle text-[9px]" title="Custom prompt active">●</span>}
            </button>
          ))}
        </div>

        <label className="label mt-4" htmlFor={`study-prompt-${tab}`}>Prompt</label>
        <textarea
          id={`study-prompt-${tab}`}
          className="field min-h-[180px] font-mono text-xs leading-relaxed"
          value={cur.prompt}
          onChange={(e) => edit(e.target.value)}
          maxLength={4000}
        />
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        <div className="mt-4 flex items-center gap-3">
          <button onClick={save} className="btn-primary" disabled={busy || !cur.prompt.trim()}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => edit(defaults[tab])} className="btn-ghost">
            Reset to default
          </button>
          {saved === tab && <span className="text-sm text-success">Saved.</span>}
        </div>
      </div>
    </section>
  );
}
