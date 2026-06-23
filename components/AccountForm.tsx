"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Initial {
  fullName: string;
  email: string;
  phone: string;
}

// Plain-English label for each Stripe status we might show.
const STATUS_LABEL: Record<string, string> = {
  trialing: "Free trial — active",
  active: "Active",
  past_due: "Payment failed — please update your card",
  canceled: "Cancelled",
  unpaid: "Unpaid",
  incomplete: "Not finished",
  incomplete_expired: "Expired",
};

export function AccountForm({
  initial,
  billingEnabled = false,
  subscriptionStatus = null,
}: {
  initial: Initial;
  billingEnabled?: boolean;
  subscriptionStatus?: string | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState({ ...initial, password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [portalBusy, setPortalBusy] = useState(false);
  const [portalError, setPortalError] = useState("");

  // Show the Subscription section ONLY when billing is on AND this user actually
  // has a subscription. When billing is off, nothing new renders (the account
  // page looks exactly as it does today).
  const showSubscription = billingEnabled && Boolean(subscriptionStatus);

  async function openPortal() {
    setPortalBusy(true);
    setPortalError("");
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.url) {
        window.location.href = body.url;
        return; // leaving the page — keep the button disabled
      }
      setPortalError(body.error ?? "Something went wrong. Please try again.");
    } catch {
      setPortalError("Something went wrong. Please try again.");
    }
    setPortalBusy(false);
  }

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

      {showSubscription && (
        <div className="card mt-6 max-w-xl space-y-4 p-6">
          <h2 className="text-lg font-semibold text-ink">Subscription</h2>
          <p className="text-sm text-muted">
            Status:{" "}
            <span className="font-medium text-ink">
              {STATUS_LABEL[subscriptionStatus ?? ""] ?? subscriptionStatus}
            </span>
          </p>
          <div>
            <button type="button" className="btn-ghost" onClick={openPortal} disabled={portalBusy}>
              {portalBusy ? "Opening…" : "Manage or cancel"}
            </button>
            {portalError && <p className="mt-2 text-sm text-danger">{portalError}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
