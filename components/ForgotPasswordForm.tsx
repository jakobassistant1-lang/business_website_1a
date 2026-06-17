"use client";

import { useState } from "react";

// Step 1 of the reset flow: enter an email. We always show the SAME "check your
// email" confirmation afterwards — even for an unknown address or a network error —
// so the page never reveals whether an account exists (matches the API route).
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => {});
    setBusy(false);
    setSent(true);
  }

  if (sent) {
    return (
      <div className="card p-6 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Check your email</h1>
        <p className="mt-2 text-sm text-muted">
          If an account exists for <span className="font-medium text-ink">{email}</span>, we&apos;ve sent a link to reset
          your password. It expires in 1 hour.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="mt-1 text-sm text-muted">Enter your email and we&apos;ll send you a reset link.</p>
      </div>
      <div className="card p-6">
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              className="field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
        </form>
      </div>
    </>
  );
}
