"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SignupForm() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "", fullName: "", phone: "" });
  const [tos, setTos] = useState(false); // FR-1.2: unchecked by default
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setBusy(true);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, tosAccepted: tos }),
    });
    setBusy(false);
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      setErrors(body.errors ?? { email: body.error ?? "Sign up failed." });
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="label" htmlFor="fullName">Full name</label>
        <input id="fullName" className="field" value={form.fullName}
          onChange={(e) => set("fullName", e.target.value)} required />
        {errors.fullName && <p className="mt-1 text-xs text-danger">{errors.fullName}</p>}
      </div>
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" type="email" className="field" value={form.email}
          onChange={(e) => set("email", e.target.value)} autoComplete="email" required />
        {errors.email && <p className="mt-1 text-xs text-danger">{errors.email}</p>}
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" type="password" className="field" value={form.password}
          onChange={(e) => set("password", e.target.value)} autoComplete="new-password" required />
        {errors.password && <p className="mt-1 text-xs text-danger">{errors.password}</p>}
      </div>
      <div>
        <label className="label" htmlFor="phone">Phone <span className="font-normal text-muted">(optional)</span></label>
        <input id="phone" className="field" value={form.phone}
          onChange={(e) => set("phone", e.target.value)} autoComplete="tel" />
      </div>

      <label className="flex items-start gap-2.5 text-sm text-ink">
        <input type="checkbox" checked={tos} onChange={(e) => setTos(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-line text-accent focus:ring-accent-ring" />
        <span>I agree to the Terms of Service</span>
      </label>
      {errors.tos && <p className="-mt-2 text-xs text-danger">{errors.tos}</p>}

      <button type="submit" className="btn-primary w-full" disabled={!tos || busy}>
        {busy ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}
