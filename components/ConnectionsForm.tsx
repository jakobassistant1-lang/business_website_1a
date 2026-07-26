"use client";

import { useState } from "react";
import { toneSoft, type Tone } from "@/lib/tone";
import { normalizeHost } from "@/lib/host";
import { SchoolPicker } from "@/components/SchoolPicker";
import { FirstSyncProgress } from "@/components/FirstSyncProgress";
import type { School } from "@/lib/schools";

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

type Step = "choose-school" | "get-token";

export function ConnectionsForm({ initial }: { initial: Initial }) {
  const connectedAtStart = initial.status === "valid" && initial.hasToken;
  const [editing, setEditing] = useState(!connectedAtStart);
  const [step, setStep] = useState<Step>(initial.host ? "get-token" : "choose-school");
  const [mode, setMode] = useState<"picker" | "manual">("picker");
  const [host, setHost] = useState(initial.host);
  const [manualHost, setManualHost] = useState(initial.host);
  const [schoolName, setSchoolName] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<string | null>(initial.status);
  const [accountName, setAccountName] = useState<string | null>(initial.accountName);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Set when THIS visit completed a connect — swaps the static "Go to your plan"
  // link for the staged first-sync progress (#64), which lands on the dashboard.
  const [justConnected, setJustConnected] = useState(false);

  const pill = status ? STATUS_PILL[status] : null;
  const tokenPageUrl = host ? `https://${host}/profile/settings` : null;

  function chooseSchool(s: School) {
    setHost(s.host);
    setSchoolName(s.name);
    setStatus(null);
    setAccountName(null);
    setMessage(null);
    setStep("get-token");
  }

  function continueManual() {
    const h = normalizeHost(manualHost);
    if (!h) {
      setMessage("Enter your Canvas web address first (e.g. school.instructure.com).");
      return;
    }
    setHost(h);
    setSchoolName(null);
    setStatus(null);
    setAccountName(null);
    setMessage(null);
    setStep("get-token");
  }

  function changeSchool() {
    setMessage(null);
    setStatus(null);
    setToken("");
    setStep("choose-school");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = token.trim();
    if (!t) {
      setMessage("Paste your Canvas token first.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/canvas/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, token: t }),
      });
      const body = await res.json().catch(() => ({}));
      if (body.error) {
        setMessage(body.error);
        return;
      }
      setStatus(body.status);
      setAccountName(body.accountName ?? null);
      setMessage(body.message);
      if (body.status === "valid") {
        setToken("");
        setJustConnected(true); // kick off the visible first sync (#64)
        setEditing(false); // collapse back to the connected summary
      }
    } catch {
      setMessage("Something went wrong reaching Navo. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  // --- Connected (collapsed) summary -------------------------------------
  if (!editing) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
        <p className="mt-1 text-sm text-muted">Link the Canvas account Navo reads your coursework from.</p>

        <div className="card mt-6 max-w-xl p-6">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-sm font-medium text-ink">Canvas</span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${toneSoft.success}`}>
              Connected{accountName ? ` · ${accountName}` : ""}
            </span>
          </div>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">School</dt>
              <dd className="truncate text-ink">{host}</dd>
            </div>
            {accountName && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Account</dt>
                <dd className="truncate text-ink">{accountName}</dd>
              </div>
            )}
          </dl>
          {justConnected && <FirstSyncProgress />}
          <div className="mt-4 flex items-center gap-3">
            {!justConnected && <a href="/dashboard" className="btn-primary">Go to your plan →</a>}
            <button
              type="button"
              className="btn-ghost"
              onClick={() => { setEditing(true); setStep(host ? "get-token" : "choose-school"); setStatus(null); setMessage(null); }}
            >
              Change connection
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Guided connect flow -----------------------------------------------
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Connect Canvas</h1>
      <p className="mt-1 text-sm text-muted">
        Pick your school and we’ll walk you through linking Canvas — it takes about a minute.
      </p>

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

        {step === "choose-school" ? (
          mode === "picker" ? (
            <SchoolPicker
              onSelect={chooseSchool}
              onManual={() => { setMode("manual"); setMessage(null); }}
            />
          ) : (
            <div className="space-y-3">
              <div>
                <label className="label" htmlFor="host">Your Canvas web address</label>
                <input
                  id="host"
                  className="field"
                  placeholder="school.instructure.com"
                  value={manualHost}
                  onChange={(e) => setManualHost(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); continueManual(); } }}
                />
                <p className="mt-1 text-xs text-muted">
                  Just the address — we add https:// for you. It usually ends in “.instructure.com”.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button type="button" className="btn-primary" onClick={continueManual}>Continue</button>
                <button
                  type="button"
                  className="text-sm font-medium text-accent hover:underline"
                  onClick={() => { setMode("picker"); setMessage(null); }}
                >
                  ← Back to school list
                </button>
              </div>
            </div>
          )
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="flex items-center justify-between rounded-lg bg-surface-soft px-3 py-2 text-sm">
              <span className="truncate text-ink">{schoolName ?? host}</span>
              <button
                type="button"
                className="shrink-0 text-xs font-medium text-accent hover:underline"
                onClick={changeSchool}
              >
                Change
              </button>
            </div>

            <div className="rounded-lg border border-line-subtle p-4">
              <p className="text-sm font-medium text-ink">Get your Canvas access token</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted">
                <li>Open Canvas with the button below — it opens in a new tab.</li>
                <li>Go to <strong className="text-ink">Account → Settings</strong>, then under <strong className="text-ink">Approved Integrations</strong> click <strong className="text-ink">+ New Access Token</strong>.</li>
                <li>For Purpose type “Navo”, leave the expiry date <strong className="text-ink">blank</strong>, then click <strong className="text-ink">Generate Token</strong>.</li>
                <li>Copy the token (Canvas shows it only once) and paste it below.</li>
              </ol>
              {tokenPageUrl && (
                <a
                  href={tokenPageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary mt-3 inline-flex"
                >
                  Open Canvas to get your token ↗
                </a>
              )}
            </div>

            <div>
              <label className="label" htmlFor="token">Paste your access token</label>
              <input
                id="token"
                type="password"
                className="field"
                placeholder={initial.hasToken ? "•••••••• (paste again to update)" : "Paste your Canvas token"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
              />
              <p className="mt-1 text-xs text-muted">
                Your token is encrypted and only used to read your Canvas coursework.
              </p>
            </div>

            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? "Validating…" : "Connect Canvas"}
            </button>
          </form>
        )}

        {message && (
          <p className={`mt-4 rounded-lg px-3 py-2 text-sm ${status === "valid" ? toneSoft.success : toneSoft.danger}`}>
            {message}
          </p>
        )}

        {connectedAtStart && (
          <button
            type="button"
            className="mt-4 block text-sm font-medium text-muted hover:underline"
            onClick={() => { setEditing(false); setMessage(null); }}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
