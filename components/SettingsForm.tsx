"use client";

import { useState } from "react";

interface Initial {
  defaultHoursPerDay: number;
  studyDaysTest: number;
  studyDaysQuiz: number;
}

export function SettingsForm({ initial }: { initial: Initial }) {
  const [form, setForm] = useState({
    defaultHoursPerDay: String(initial.defaultHoursPerDay),
    studyDaysTest: String(initial.studyDaysTest),
    studyDaysQuiz: String(initial.studyDaysQuiz),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setSaved(false);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        defaultHoursPerDay: Number(form.defaultHoursPerDay),
        studyDaysTest: Number(form.studyDaysTest),
        studyDaysQuiz: Number(form.studyDaysQuiz),
      }),
    });
    setBusy(false);
    if (res.ok) setSaved(true);
    else {
      const body = await res.json().catch(() => ({}));
      setErrors(body.errors ?? {});
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-muted">How the planner builds your week. (Effort per assignment is now estimated automatically by AI.)</p>

      <form onSubmit={onSubmit} className="card mt-6 max-w-xl space-y-5 p-6">
        <Field label="Hours you can study per day" hint="Your daily study budget — the planner schedules work and study within it."
          value={form.defaultHoursPerDay} onChange={(v) => set("defaultHoursPerDay", v)}
          type="number" min="0.5" max="24" step="0.5" error={errors.defaultHoursPerDay} />
        <Field label="Start studying for exams/tests (days ahead)" hint="How many days before an exam the planner begins scheduling study sessions."
          value={form.studyDaysTest} onChange={(v) => set("studyDaysTest", v)}
          type="number" min="1" max="14" step="1" error={errors.studyDaysTest} />
        <Field label="Start studying for quizzes (days ahead)" hint="How many days before a quiz the planner begins scheduling study sessions."
          value={form.studyDaysQuiz} onChange={(v) => set("studyDaysQuiz", v)}
          type="number" min="1" max="14" step="1" error={errors.studyDaysQuiz} />

        <div className="flex items-center gap-3">
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save settings"}
          </button>
          {saved && <span className="text-sm text-success">Saved.</span>}
        </div>
      </form>
    </div>
  );
}

function Field(props: {
  label: string; hint?: string; value: string; onChange: (v: string) => void;
  type?: string; min?: string; max?: string; step?: string; error?: string;
}) {
  return (
    <div>
      <label className="label">{props.label}</label>
      <input
        className="field max-w-[12rem]" type={props.type} min={props.min} max={props.max} step={props.step}
        value={props.value} onChange={(e) => props.onChange(e.target.value)}
      />
      {props.hint && <p className="mt-1 text-xs text-muted">{props.hint}</p>}
      {props.error && <p className="mt-1 text-xs text-danger">{props.error}</p>}
    </div>
  );
}
