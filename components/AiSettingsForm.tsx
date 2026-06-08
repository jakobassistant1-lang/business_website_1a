"use client";

import { useState } from "react";

export function AiSettingsForm({
  initialPrompt,
  defaultPrompt,
  isCustom,
}: {
  initialPrompt: string;
  defaultPrompt: string;
  isCustom: boolean;
}) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [custom, setCustom] = useState(isCustom);

  function edit(v: string) {
    setPrompt(v);
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await fetch("/api/admin/briefing-prompt", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    setBusy(false);
    if (res.ok) {
      setSaved(true);
      setCustom(true);
    } else {
      const b = await res.json().catch(() => ({}));
      setError(b.error ?? "Couldn't save. Try again.");
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">AI briefing settings</h1>
      <p className="mt-1 text-sm text-muted">
        Edit the instructions Gemini follows when writing each student&apos;s daily briefing. Changes take effect
        within about a minute — no redeploy. {custom ? "A custom prompt is active." : "Using the built-in default."}
      </p>

      <div className="card mt-6 p-6">
        <label className="label" htmlFor="prompt">Briefing prompt</label>
        <textarea
          id="prompt"
          className="field min-h-[220px] font-mono text-xs leading-relaxed"
          value={prompt}
          onChange={(e) => edit(e.target.value)}
          maxLength={4000}
        />
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        <div className="mt-4 flex items-center gap-3">
          <button onClick={save} className="btn-primary" disabled={busy || !prompt.trim()}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => edit(defaultPrompt)} className="btn-ghost">
            Reset to default
          </button>
          {saved && <span className="text-sm text-success">Saved.</span>}
        </div>
      </div>

      <div className="card mt-4 p-5">
        <h2 className="text-sm font-semibold text-ink">How this works</h2>
        <ul className="mt-2 space-y-1.5 text-sm text-muted">
          <li>• This is the <strong className="text-ink">style and coaching guidance</strong> only. The app automatically gives Gemini the student&apos;s plan and ranked priorities — you don&apos;t add assignment data here.</li>
          <li>• Good things to tweak: tone (encouraging, blunt), length (&ldquo;under 3 sentences&rdquo;), and what to emphasize (&ldquo;always name the single most urgent item first&rdquo;).</li>
          <li>• Tell it what to avoid too (&ldquo;no lists&rdquo;, &ldquo;don&apos;t invent deadlines&rdquo;).</li>
          <li>• It does <strong className="text-ink">not</strong> change how assignments are ranked — that&apos;s deterministic logic, separate from the AI.</li>
        </ul>
      </div>
    </div>
  );
}
