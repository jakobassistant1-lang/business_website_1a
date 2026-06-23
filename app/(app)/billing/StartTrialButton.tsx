"use client";

import { useState } from "react";

// Small client island: POSTs to /api/billing/checkout and sends the browser to
// the Stripe-hosted checkout URL it returns. Everything else on the billing page
// is server-rendered.
export function StartTrialButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/billing/checkout", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.url) {
        window.location.href = body.url;
        return; // leaving the page — keep the button disabled
      }
      setError(body.error ?? "Something went wrong. Please try again.");
    } catch {
      setError("Something went wrong. Please try again.");
    }
    setBusy(false);
  }

  return (
    <div className="mt-6">
      <button type="button" className="btn-primary" onClick={start} disabled={busy}>
        {busy ? "Taking you to checkout…" : "Start my free trial"}
      </button>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
