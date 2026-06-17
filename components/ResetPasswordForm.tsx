"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Step 2 of the reset flow: choose a new password. The token comes from the emailed
// link (?token=). Client-side checks (length, match) are for fast feedback; the API
// re-validates and is the source of truth. A bad/expired token returns the same
// generic error the server sends.
export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    setBusy(false);
    if (res.ok) {
      setDone(true);
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "This reset link is invalid or has expired.");
    }
  }

  if (done) {
    return (
      <div className="card p-6 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Password updated</h1>
        <p className="mt-2 text-sm text-muted">Your password has been changed. You can now log in with it.</p>
        <button onClick={() => router.push("/login")} className="btn-primary mt-4 w-full">
          Log in
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
        <p className="mt-1 text-sm text-muted">Enter a new password for your account.</p>
      </div>
      <div className="card p-6">
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <div>
            <label className="label" htmlFor="password">New password</label>
            <input
              id="password"
              type="password"
              className="field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="confirm">Confirm new password</label>
            <input
              id="confirm"
              type="password"
              className="field"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? "Updating…" : "Update password"}
          </button>
        </form>
      </div>
    </>
  );
}
