"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NETWORK_ERROR } from "@/lib/messages";

interface Initial {
  fullName: string;
  email: string;
  phone: string;
}

type ErrorKey = "fullName" | "email" | "password";

export function AccountForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [form, setForm] = useState({ ...initial, password: "" });
  const [errors, setErrors] = useState<Partial<Record<ErrorKey, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
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
    setFormError(null);
    setSaved(false);
    const payload: Record<string, string> = {
      fullName: form.fullName,
      email: form.email,
      phone: form.phone,
    };
    if (form.password) payload.password = form.password;

    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setSaved(true);
        setForm((f) => ({ ...f, password: "" }));
        router.refresh(); // update sidebar name/email
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (body.errors) setErrors(body.errors);
      else setFormError("Couldn’t save your changes. Reload the page and try again.");
    } catch {
      setFormError(NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  /** Error wiring for one input: aria-invalid + aria-describedby → its error line. */
  const a11y = (k: ErrorKey) => ({
    "aria-invalid": Boolean(errors[k]),
    "aria-describedby": errors[k] ? `${k}-error` : undefined,
  });
  const errorLine = (k: ErrorKey) =>
    errors[k] ? <p id={`${k}-error`} role="alert" className="mt-1 text-xs text-danger">{errors[k]}</p> : null;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
      <p className="mt-1 text-sm text-muted">Update your name, email, phone and password.</p>

      <form onSubmit={onSubmit} className="card mt-6 max-w-xl space-y-6 p-5 sm:p-6 md:space-y-4">
        <div>
          <label className="label" htmlFor="fullName">Full name</label>
          <input id="fullName" name="name" className="field" value={form.fullName} onChange={(e) => set("fullName", e.target.value)} autoComplete="name" {...a11y("fullName")} />
          {errorLine("fullName")}
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" className="field" value={form.email} onChange={(e) => set("email", e.target.value)} autoComplete="email" autoCapitalize="none" spellCheck={false} {...a11y("email")} />
          {errorLine("email")}
        </div>
        <div>
          <label className="label" htmlFor="phone">Phone <span className="font-normal text-muted">(optional)</span></label>
          <input id="phone" name="phone" type="tel" className="field" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="password">New password <span className="font-normal text-muted">(leave blank to keep)</span></label>
          <input id="password" name="password" type="password" className="field" value={form.password} onChange={(e) => set("password", e.target.value)} autoComplete="new-password" spellCheck={false} {...a11y("password")} />
          {errorLine("password")}
        </div>

        {formError && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        )}
        <div className="flex items-center gap-3 max-md:flex-wrap">
          <button type="submit" className="btn-primary max-md:tap max-sm:w-full" disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </button>
          <span role="status" className="text-sm text-success">{saved ? "Changes saved." : ""}</span>
        </div>
      </form>
    </div>
  );
}
