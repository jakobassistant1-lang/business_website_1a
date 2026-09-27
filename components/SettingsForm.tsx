"use client";

import { useId, useState } from "react";
import { NETWORK_ERROR } from "@/lib/messages";

interface Initial {
  defaultHoursPerDay: number;
  studyDaysTest: number;
  studyDaysQuiz: number;
}

type Key = "defaultHoursPerDay" | "studyDaysTest" | "studyDaysQuiz";

export function SettingsForm({ initial }: { initial: Initial }) {
  const [form, setForm] = useState<Record<Key, string>>({
    defaultHoursPerDay: String(initial.defaultHoursPerDay),
    studyDaysTest: String(initial.studyDaysTest),
    studyDaysQuiz: String(initial.studyDaysQuiz),
  });
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  function set(key: Key, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultHoursPerDay: Number(form.defaultHoursPerDay),
          studyDaysTest: Number(form.studyDaysTest),
          studyDaysQuiz: Number(form.studyDaysQuiz),
        }),
      });
      if (res.ok) {
        setSaved(true);
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (body.errors) setErrors(body.errors);
      else setFormError("Couldn't save your settings. Reload the page and try again.");
    } catch {
      setFormError(NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-muted">How the planner builds your week.</p>

      <form onSubmit={onSubmit} className="card mt-6 max-w-xl space-y-6 p-5 sm:p-6 md:space-y-5">
        <Field label="Hours you can study per day" hint="Your daily study budget — the planner schedules work and study within it."
          value={form.defaultHoursPerDay} onChange={(v) => set("defaultHoursPerDay", v)}
          type="number" inputMode="decimal" min="0.5" max="24" step="0.5" error={errors.defaultHoursPerDay} />
        <Field label="Start studying for exams/tests (days ahead)" hint="How many days before an exam the planner begins scheduling study sessions."
          value={form.studyDaysTest} onChange={(v) => set("studyDaysTest", v)}
          type="number" inputMode="numeric" min="1" max="14" step="1" error={errors.studyDaysTest} />
        <Field label="Start studying for quizzes (days ahead)" hint="How many days before a quiz the planner begins scheduling study sessions."
          value={form.studyDaysQuiz} onChange={(v) => set("studyDaysQuiz", v)}
          type="number" inputMode="numeric" min="1" max="14" step="1" error={errors.studyDaysQuiz} />

        {formError && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        )}
        <div className="flex items-center gap-3 max-md:flex-wrap">
          <button type="submit" className="btn-primary max-md:tap max-sm:w-full" disabled={busy}>
            {busy ? "Saving…" : "Save settings"}
          </button>
          <span role="status" className="text-sm text-success">{saved ? "Settings saved." : ""}</span>
        </div>
      </form>
    </div>
  );
}

function Field(props: {
  label: string; hint?: string; value: string; onChange: (v: string) => void;
  type?: string; min?: string; max?: string; step?: string; error?: string;
  /** Phone keypad: "numeric" for whole days, "decimal" when the step allows halves. */
  inputMode?: "numeric" | "decimal";
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [props.error ? errorId : null, props.hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label className="label" htmlFor={id}>{props.label}</label>
      <input
        id={id} className="field md:max-w-[12rem]" type={props.type} inputMode={props.inputMode} min={props.min} max={props.max} step={props.step}
        value={props.value} onChange={(e) => props.onChange(e.target.value)}
        aria-invalid={Boolean(props.error)} aria-describedby={describedBy}
      />
      {props.hint && <p id={hintId} className="mt-1 text-xs text-muted">{props.hint}</p>}
      {props.error && <p id={errorId} role="alert" className="mt-1 text-xs text-danger">{props.error}</p>}
    </div>
  );
}
