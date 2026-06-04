"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Initial {
  fullName: string;
  email: string;
  phone: string;
}

export function AccountForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [form, setForm] = useState({ ...initial, password: "" });
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
    const payload: Record<string, string> = {
      fullName: form.fullName,
      email: form.email,
      phone: form.phone,
    };
    if (form.password) payload.password = form.password;

    const res = await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (res.ok) {
      setSaved(true);
      setForm((f) => ({ ...f, password: "" }));
      router.refresh(); // update sidebar name/email
    } else {
      const body = await res.json().catch(() => ({}));
      setErrors(body.errors ?? {});
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
      <p className="mt-1 text-sm text-muted">Your local profile.</p>

      <form onSubmit={onSubmit} className="card mt-6 max-w-xl space-y-4 p-6">
        <div>
          <label className="label" htmlFor="fullName">Full name</label>
          <input id="fullName" className="field" value={form.fullName} onChange={(e) => set("fullName", e.target.value)} />
          {errors.fullName && <p className="mt-1 text-xs text-danger">{errors.fullName}</p>}
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" type="email" className="field" value={form.email} onChange={(e) => set("email", e.target.value)} />
          {errors.email && <p className="mt-1 text-xs text-danger">{errors.email}</p>}
        </div>
        <div>
          <label className="label" htmlFor="phone">Phone <span className="font-normal text-muted">(optional)</span></label>
          <input id="phone" className="field" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="password">New password <span className="font-normal text-muted">(leave blank to keep)</span></label>
          <input id="password" type="password" className="field" value={form.password} onChange={(e) => set("password", e.target.value)} autoComplete="new-password" />
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </button>
          {saved && <span className="text-sm text-success">Saved.</span>}
        </div>
      </form>
    </div>
  );
}
