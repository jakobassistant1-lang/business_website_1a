"use client";

import { useState } from "react";

// One reusable editor for an admin-tunable prompt (briefing or analysis).
export function AiSettingsForm({
  title,
  description,
  endpoint,
  initialPrompt,
  defaultPrompt,
  isCustom,
}: {
  title: string;
  description: string;
  endpoint: string; // PUT target, e.g. /api/admin/briefing-prompt
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
    const res = await fetch(endpoint, {
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
    <section>
      <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
      <p className="mt-1 text-sm text-muted">
        {description} {custom ? "A custom prompt is active." : "Using the built-in default."}
      </p>
      <div className="card mt-3 p-6">
        <label className="label" htmlFor={endpoint}>Prompt</label>
        <textarea
          id={endpoint}
          className="field min-h-[200px] font-mono text-xs leading-relaxed"
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
    </section>
  );
}
