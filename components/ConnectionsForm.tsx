"use client";

import { useState } from "react";
import { toneSoft, type Tone } from "@/lib/tone";

interface Initial {
  host: string;
  hasToken: boolean;
  status: string | null;
  accountName: string | null;
}

const STATUS_PILL: Record<string, { text: string; tone: Tone }> = {
  valid: { text: "Connected", tone: "success" },
  invalid_token: { text: "Token rejected", tone: "danger" },
  bad_domain: { text: "Bad domain", tone: "danger" },
  unreachable: { text: "Unreachable", tone: "danger" },
  insufficient_scope: { text: "Insufficient scope", tone: "danger" },
  error: { text: "Error", tone: "danger" },
};

export function ConnectionsForm({ initial }: { initial: Initial }) {
  const [host, setHost] = useState(initial.host);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<string | null>(initial.status);
  const [accountName, setAccountName] = useState<string | null>(initial.accountName);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/canvas/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host, token }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (body.error) {
      setMessage(body.error);
      return;
    }
    setStatus(body.status);
    setAccountName(body.accountName ?? null);
    setMessage(body.message);
  }

  const pill = status ? STATUS_PILL[status] : null;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
      <p className="mt-1 text-sm text-muted">Link the Canvas account StudyPlan reads your coursework from.</p>

      <div className="card mt-6 max-w-xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm font-medium text-ink">Canvas</span>
          {pill && (
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${toneSoft[pill.tone]}`}>
              {pill.text}
              {status === "valid" && accountName ? ` · ${accountName}` : ""}
            </span>
          )}
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="host">Canvas domain</label>
            <input id="host" className="field" placeholder="school.instructure.com"
              value={host} onChange={(e) => setHost(e.target.value)} required />
            <p className="mt-1 text-xs text-muted">Just the host — we add https:// and /api/v1.</p>
          </div>
          <div>
            <label className="label" htmlFor="token">Personal access token</label>
            <input id="token" type="password" className="field"
              placeholder={initial.hasToken ? "•••••••• (re-enter to update)" : "Paste your Canvas token"}
              value={token} onChange={(e) => setToken(e.target.value)} required />
            <p className="mt-1 text-xs text-muted">
              Canvas → Account → Settings → New Access Token. Stored locally in plaintext.
            </p>
          </div>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Validating…" : "Save & validate"}
          </button>
        </form>

        {message && (
          <p className={`mt-4 rounded-lg px-3 py-2 text-sm ${
            status === "valid" ? toneSoft.success : toneSoft.danger
          }`}>
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
