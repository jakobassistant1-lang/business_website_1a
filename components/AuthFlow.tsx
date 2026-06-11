"use client";

// Two-step auth. Step 1: pick Student or Admin. Step 2: log in or sign up.
// - Students sign up with NO invite code (open) → a regular account.
// - Admins sign up WITH the invite code (first time only) → the account is
//   remembered as admin (isAdmin), so later they just use email + password.
// Login is identical for both; the account's own isAdmin flag decides access.

import { useState } from "react";
import { useRouter } from "next/navigation";

type Role = "student" | "admin";
type Mode = "login" | "signup";

const STUDENT_ICON = "M22 10L12 5 2 10l10 5 10-5Zm-4 3.5V17c0 1.5-3 2.5-6 2.5s-6-1-6-2.5v-3.5";
const ADMIN_ICON = "M4 5h16v14H4zM9 5v14M15 5v14";

export function AuthFlow({ initialMode, inviteConfigured }: { initialMode: Mode; inviteConfigured: boolean }) {
  const router = useRouter();
  const [role, setRole] = useState<Role | null>(null);
  const [mode, setMode] = useState<Mode>(initialMode);

  function finish(isAdmin: boolean) {
    router.push(isAdmin ? "/admin" : "/");
    router.refresh();
  }

  if (role === null) {
    return (
      <>
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Welcome to StudyPlan</h1>
          <p className="mt-1 text-sm text-muted">Who&apos;s signing in?</p>
        </div>
        <div className="space-y-3">
          <RoleCard
            icon={STUDENT_ICON}
            title="I'm a student"
            blurb="Connect Canvas and see your daily plan."
            onClick={() => setRole("student")}
          />
          <RoleCard
            icon={ADMIN_ICON}
            title="I'm an admin"
            blurb="Team tools — board, hierarchy, and burndown."
            onClick={() => setRole("admin")}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <div className="mb-5 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
          {role === "admin" ? "Admin" : "Student"}
        </span>
        <button type="button" onClick={() => setRole(null)} className="text-xs font-medium text-muted hover:text-ink">
          ← Change
        </button>
      </div>
      <div className="card p-6">
        {mode === "login" ? (
          <LoginForm onDone={finish} />
        ) : (
          <SignupForm role={role} inviteConfigured={inviteConfigured} onDone={finish} />
        )}
      </div>
      <p className="mt-6 text-center text-sm text-muted">
        {mode === "login" ? (
          <>
            New here?{" "}
            <button onClick={() => setMode("signup")} className="font-medium text-accent hover:text-accent-hover">
              Create {role === "admin" ? "an admin" : "a student"} account
            </button>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <button onClick={() => setMode("login")} className="font-medium text-accent hover:text-accent-hover">
              Log in
            </button>
          </>
        )}
      </p>
    </>
  );
}

function RoleCard({ icon, title, blurb, onClick }: { icon: string; title: string; blurb: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="card flex w-full items-center gap-4 p-5 text-left transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-accent-ring"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d={icon} />
        </svg>
      </span>
      <span className="min-w-0">
        <span className="block font-semibold text-ink">{title}</span>
        <span className="block text-sm text-muted">{blurb}</span>
      </span>
      <span className="ml-auto shrink-0 text-faint">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </span>
    </button>
  );
}

function LoginForm({ onDone }: { onDone: (isAdmin: boolean) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (res.ok) {
      const body = await res.json().catch(() => ({}));
      onDone(body.isAdmin === true);
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Invalid credentials.");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" type="email" className="field" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" type="password" className="field" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </div>
      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? "Signing in…" : "Log in"}
      </button>
    </form>
  );
}

function SignupForm({ role, inviteConfigured, onDone }: { role: Role; inviteConfigured: boolean; onDone: (isAdmin: boolean) => void }) {
  const isAdmin = role === "admin";
  const [form, setForm] = useState({ inviteCode: "", email: "", password: "", fullName: "", phone: "" });
  const [tos, setTos] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setBusy(true);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, role, tosAccepted: tos }),
    });
    setBusy(false);
    if (res.ok) {
      onDone(isAdmin);
    } else {
      const body = await res.json().catch(() => ({}));
      setErrors(body.errors ?? { email: body.error ?? "Sign up failed." });
    }
  }

  if (isAdmin && !inviteConfigured) {
    return (
      <p className="text-sm text-muted">
        Admin sign-up isn&apos;t enabled yet — set a <code className="text-ink">SIGNUP_INVITE_CODE</code> so the first admin can register.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {isAdmin && (
        <div>
          <label className="label" htmlFor="inviteCode">Admin invite code</label>
          <input id="inviteCode" className="field" value={form.inviteCode} onChange={(e) => set("inviteCode", e.target.value)} autoComplete="off" required />
          {errors.inviteCode && <p className="mt-1 text-xs text-danger">{errors.inviteCode}</p>}
          <p className="mt-1 text-xs text-muted">Needed once, the first time you register as an admin.</p>
        </div>
      )}
      <div>
        <label className="label" htmlFor="fullName">Full name</label>
        <input id="fullName" className="field" value={form.fullName} onChange={(e) => set("fullName", e.target.value)} required />
        {errors.fullName && <p className="mt-1 text-xs text-danger">{errors.fullName}</p>}
      </div>
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" type="email" className="field" value={form.email} onChange={(e) => set("email", e.target.value)} autoComplete="email" required />
        {errors.email && <p className="mt-1 text-xs text-danger">{errors.email}</p>}
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" type="password" className="field" value={form.password} onChange={(e) => set("password", e.target.value)} autoComplete="new-password" required />
        {errors.password && <p className="mt-1 text-xs text-danger">{errors.password}</p>}
      </div>
      <div>
        <label className="label" htmlFor="phone">Phone <span className="font-normal text-muted">(optional)</span></label>
        <input id="phone" className="field" value={form.phone} onChange={(e) => set("phone", e.target.value)} autoComplete="tel" />
      </div>
      <label className="flex items-start gap-2.5 text-sm text-ink">
        <input type="checkbox" checked={tos} onChange={(e) => setTos(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-line text-accent focus:ring-accent-ring" />
        <span>I agree to the Terms of Service</span>
      </label>
      {errors.tos && <p className="-mt-2 text-xs text-danger">{errors.tos}</p>}
      <button type="submit" className="btn-primary w-full" disabled={!tos || busy}>
        {busy ? "Creating account…" : `Create ${isAdmin ? "admin " : ""}account`}
      </button>
    </form>
  );
}
