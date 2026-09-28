"use client";

// Log in / sign up. Students land straight on the form (/login, /signup); the
// admin door is the unlinked /admin/login route, which passes role="admin".
// - Students sign up with NO invite code (open) → a regular account.
// - Admins sign up WITH the invite code (first time only) → the account is
//   remembered as admin (isAdmin), so later they just use email + password.
// Login is identical for both; the account's own isAdmin flag decides access.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
// Type only (erased at build): the terms are computed on the server — the price
// comes from Stripe and the trial length from TRIAL_DAYS, never from this file.
import type { TrialTerms } from "@/lib/subscription";
import { NETWORK_ERROR, TOS_REQUIRED } from "@/lib/messages";

type Role = "student" | "admin";
type Mode = "login" | "signup";

export const TERMS_URL = "https://navolearning.com/terms";
export const PRIVACY_URL = "https://navolearning.com/privacy";

const HEADING: Record<Role, Record<Mode, string>> = {
  student: { login: "Log in to Navo", signup: "Create your Navo account" },
  admin: { login: "Log in as an admin", signup: "Create an admin account" },
};

/** The one value line on the student signup door (the price line below it comes from Stripe). */
const VALUE_LINE = "Navo connects to your Canvas classes and tells you what to work on next.";

export type SignupField = "inviteCode" | "fullName" | "email" | "password" | "tos";
export type SignupErrors = Partial<Record<SignupField, string>>;
/** Top-to-bottom form order: focus lands on the first field with an error. */
const FIELD_ORDER: SignupField[] = ["inviteCode", "fullName", "email", "password", "tos"];

/** The first field (in form order) that has an error, or null. */
export function firstInvalidField(errors: SignupErrors): SignupField | null {
  return FIELD_ORDER.find((k) => errors[k]) ?? null;
}

/** Pure client check run before signup is sent: the first invalid field + its
 *  message, or null when the form can go. Empty required fields are caught by the
 *  browser (`required`); the Terms box is checked here so submit never sits
 *  disabled without saying why. */
export function validateAuthForm(values: { tos: boolean }): { field: SignupField; message: string } | null {
  if (!values.tos) return { field: "tos", message: TOS_REQUIRED };
  return null;
}

/** Only a 401 (wrong email or password) marks the login fields invalid. A network
 *  failure (status null) or a rate limit (429) is about the attempt, not the input. */
export function loginFieldsInvalid(status: number | null): boolean {
  return status === 401;
}

export function AuthFlow({
  role = "student",
  initialMode,
  inviteConfigured,
  googleEnabled,
  notice,
  trialTerms,
}: {
  role?: Role;
  initialMode: Mode;
  inviteConfigured: boolean;
  googleEnabled: boolean;
  notice?: string;
  trialTerms?: TrialTerms | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);

  function finish(isAdmin: boolean) {
    router.push(isAdmin ? "/admin" : "/");
    router.refresh();
  }

  return (
    <>
      {notice && (
        <div className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          {notice}
        </div>
      )}
      <div className="mb-6 text-center">
        <h1 className="text-balance text-2xl font-semibold tracking-tight">{HEADING[role][mode]}</h1>
        {role === "student" && mode === "signup" && <p className="mt-1.5 text-balance text-sm text-muted">{VALUE_LINE}</p>}
      </div>
      <div className="card p-5 sm:p-6">
        {role === "student" && mode === "signup" && trialTerms && (
          <p className="mb-5 rounded-lg bg-surface-soft px-3 py-2.5 text-[13px] leading-relaxed text-muted">
            {trialTerms.price ? (
              <>
                Free for {trialTerms.trialDays} days, then {trialTerms.price}. Cancel anytime — you won&apos;t be charged until your trial ends.
              </>
            ) : (
              <>Free for {trialTerms.trialDays} days, then a small monthly fee. Cancel anytime.</>
            )}
          </p>
        )}
        {role === "student" && googleEnabled && (
          <div className="mb-5">
            <a
              href="/api/auth/google/start"
              className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent max-md:tap"
            >
              <GoogleGlyph />
              Continue with Google
            </a>
            <p className="mt-2 text-center text-xs text-muted">
              By continuing, you agree to the <LegalLinks />.
            </p>
            <div className="mt-4 flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-line" />
              <span className="text-xs text-muted">or</span>
              <span className="h-px flex-1 bg-line" />
            </div>
          </div>
        )}
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
            <button type="button" onClick={() => setMode("signup")} className="font-medium text-accent hover:text-accent-hover max-md:tap max-md:inline-flex max-md:items-center">
              {role === "admin" ? "Create an admin account" : "Create an account"}
            </button>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <button type="button" onClick={() => setMode("login")} className="font-medium text-accent hover:text-accent-hover max-md:tap max-md:inline-flex max-md:items-center">
              Log in
            </button>
          </>
        )}
      </p>
    </>
  );
}

/** "Terms of Service and Privacy Policy", each opening the live page in a new tab.
 *  Inline links inside a sentence (WCAG 2.5.8 exempts them from the 44px target). */
function LegalLinks() {
  const cls = "font-medium text-accent underline underline-offset-2 hover:text-accent-hover";
  return (
    <>
      <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className={cls}>Terms of Service</a>
      {" and "}
      <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className={cls}>Privacy Policy</a>
    </>
  );
}

/** Field-error line, tied to its input by id (aria-describedby). Not a live region:
 *  focus moves to the invalid field, which reads this line as its description. */
function FieldError({ id, text }: { id: string; text?: string }) {
  if (!text) return null;
  return (
    <p id={id} className="mt-1 text-xs text-danger">
      {text}
    </p>
  );
}

function LoginForm({ onDone }: { onDone: (isAdmin: boolean) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  // Focus after React has rendered aria-invalid/aria-describedby onto the field.
  useEffect(() => {
    if (invalid) emailRef.current?.focus();
  }, [invalid, error]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInvalid(false);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        onDone(body.isAdmin === true);
        return;
      }
      setError(body.error ?? "That email and password don't match. Check them and try again.");
      setInvalid(loginFieldsInvalid(res.status));
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const describedBy = invalid ? "login-error" : undefined;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && (
        <p id="login-error" role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input
          ref={emailRef} id="email" name="email" type="email" className="field"
          value={email} onChange={(e) => setEmail(e.target.value)}
          autoComplete="email" autoCapitalize="none" spellCheck={false} required
          aria-invalid={invalid} aria-describedby={describedBy}
        />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input
          id="password" name="password" type="password" className="field"
          value={password} onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password" spellCheck={false} required
          aria-invalid={invalid} aria-describedby={describedBy}
        />
      </div>
      <div className="-mt-1 text-right">
        <Link href="/forgot-password" className="text-sm font-medium text-accent hover:text-accent-hover max-md:tap max-md:inline-flex max-md:items-center max-md:justify-end">
          Forgot password?
        </Link>
      </div>
      <button type="submit" className="btn-primary w-full max-md:tap" disabled={busy}>
        {busy ? "Logging in…" : "Log in"}
      </button>
    </form>
  );
}

function SignupForm({ role, inviteConfigured, onDone }: { role: Role; inviteConfigured: boolean; onDone: (isAdmin: boolean) => void }) {
  const isAdmin = role === "admin";
  const [form, setForm] = useState({ inviteCode: "", email: "", password: "", fullName: "", phone: "" });
  const [tos, setTos] = useState(false);
  const [errors, setErrors] = useState<SignupErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refs = useRef<Partial<Record<SignupField, HTMLInputElement | null>>>({});
  // Set by a submit that produced errors; the effect below focuses the first
  // invalid field once React has rendered its aria-invalid/aria-describedby
  // (ticking the Terms box later updates errors too, but must not move focus).
  const focusPending = useRef(false);
  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    const first = firstInvalidField(errors);
    if (first) refs.current[first]?.focus();
  }, [errors]);

  function showErrors(next: SignupErrors) {
    focusPending.current = true;
    setErrors(next);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    const invalid = validateAuthForm({ tos });
    if (invalid) {
      showErrors({ [invalid.field]: invalid.message });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, role, tosAccepted: tos }),
      });
      if (res.ok) {
        onDone(isAdmin);
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (body.errors) showErrors(body.errors);
      else setFormError(body.error ?? "Couldn't create your account. Try again.");
    } catch {
      setFormError(NETWORK_ERROR);
    } finally {
      setBusy(false);
    }
  }

  if (isAdmin && !inviteConfigured) {
    return (
      <p className="text-sm text-muted">
        Admin sign-up isn&apos;t enabled yet — set a <code className="text-ink">SIGNUP_INVITE_CODE</code> so the first admin can register.
      </p>
    );
  }

  /** Error wiring for one input: aria-invalid + aria-describedby → its error line. */
  const a11y = (k: SignupField, extra?: string) => ({
    "aria-invalid": Boolean(errors[k]),
    "aria-describedby": [errors[k] ? `${k}-error` : null, extra].filter(Boolean).join(" ") || undefined,
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {formError && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {formError}
        </p>
      )}
      {isAdmin && (
        <div>
          <label className="label" htmlFor="inviteCode">Admin invite code</label>
          <input
            ref={(el) => { refs.current.inviteCode = el; }} id="inviteCode" name="inviteCode" className="field"
            value={form.inviteCode} onChange={(e) => set("inviteCode", e.target.value)}
            autoComplete="off" spellCheck={false} required {...a11y("inviteCode", "inviteCode-hint")}
          />
          <FieldError id="inviteCode-error" text={errors.inviteCode} />
          <p id="inviteCode-hint" className="mt-1 text-xs text-muted">Needed once, the first time you register as an admin.</p>
        </div>
      )}
      <div>
        <label className="label" htmlFor="fullName">Full name</label>
        <input
          ref={(el) => { refs.current.fullName = el; }} id="fullName" name="name" className="field"
          value={form.fullName} onChange={(e) => set("fullName", e.target.value)}
          autoComplete="name" required {...a11y("fullName")}
        />
        <FieldError id="fullName-error" text={errors.fullName} />
      </div>
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input
          ref={(el) => { refs.current.email = el; }} id="email" name="email" type="email" className="field"
          value={form.email} onChange={(e) => set("email", e.target.value)}
          autoComplete="email" autoCapitalize="none" spellCheck={false} required {...a11y("email")}
        />
        <FieldError id="email-error" text={errors.email} />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input
          ref={(el) => { refs.current.password = el; }} id="password" name="password" type="password" className="field"
          value={form.password} onChange={(e) => set("password", e.target.value)}
          autoComplete="new-password" spellCheck={false} required {...a11y("password")}
        />
        <FieldError id="password-error" text={errors.password} />
      </div>
      <div>
        <label className="label" htmlFor="phone">Phone <span className="font-normal text-muted">(optional)</span></label>
        <input id="phone" name="phone" type="tel" className="field" inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} autoComplete="tel" />
      </div>
      <div>
        <div className="flex items-start gap-2.5 text-sm text-ink max-md:min-h-11 max-md:py-1">
          <input
            ref={(el) => { refs.current.tos = el; }} id="tos" name="tos" type="checkbox"
            checked={tos} onChange={(e) => { setTos(e.target.checked); if (e.target.checked) setErrors((prev) => ({ ...prev, tos: undefined })); }}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-accent focus:ring-accent" {...a11y("tos")}
          />
          <label htmlFor="tos">
            I agree to the <LegalLinks />
          </label>
        </div>
        <FieldError id="tos-error" text={errors.tos} />
      </div>
      <button type="submit" className="btn-primary w-full max-md:tap" disabled={busy}>
        {busy ? "Creating account…" : `Create ${isAdmin ? "admin " : ""}account`}
      </button>
    </form>
  );
}

// Google's brand mark — its official colors are fixed (not themeable), so the
// hardcoded hex here is intentional and exempt from the token-only rule.
function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.583-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" />
    </svg>
  );
}
