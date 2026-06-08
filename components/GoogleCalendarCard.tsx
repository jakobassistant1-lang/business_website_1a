"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toneSoft } from "@/lib/tone";

function fmt(iso: string | null) {
  if (!iso) return "never";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function friendly(reason?: string): string {
  if (reason === "rate_limited") return "Google is rate-limiting us. Try again in a minute.";
  if (reason === "token_expired" || reason === "not_connected") return "Your Google connection expired — please reconnect.";
  return "Sync failed. Please try again.";
}

export function GoogleCalendarCard({
  configured,
  connected,
  email,
  syncedAt,
  eventCount,
}: {
  configured: boolean;
  connected: boolean;
  email: string | null;
  syncedAt: string | null;
  eventCount: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const flash = params.get("google"); // connected | error | unconfigured (post-redirect)
  const [busy, setBusy] = useState<null | "sync" | "disconnect">(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(
    flash === "connected"
      ? { kind: "ok", text: "Google Calendar connected." }
      : flash === "error"
        ? { kind: "error", text: "Couldn't connect to Google. Please try again." }
        : flash === "unconfigured"
          ? { kind: "error", text: "Google Calendar isn't set up on the server yet." }
          : null,
  );

  async function sync() {
    setBusy("sync");
    setNotice(null);
    try {
      const res = await fetch("/api/connections/google/sync", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      setNotice(
        body.ok
          ? { kind: "ok", text: `Synced ${body.synced} event${body.synced === 1 ? "" : "s"}.` }
          : { kind: "error", text: friendly(body.reason) },
      );
    } catch {
      setNotice({ kind: "error", text: "Sync failed. Please try again." });
    }
    setBusy(null);
    router.refresh();
  }

  async function disconnect() {
    setBusy("disconnect");
    setNotice(null);
    try {
      const res = await fetch("/api/connections/google/disconnect", { method: "POST" });
      if (!res.ok) setNotice({ kind: "error", text: "Couldn't fully disconnect. Please try again." });
    } catch {
      setNotice({ kind: "error", text: "Couldn't fully disconnect. Please try again." });
    }
    setBusy(null);
    router.refresh();
  }

  // Freshly connected (redirect lands here with no sync yet) → pull events once
  // automatically so the card isn't stuck at "0 events / never synced".
  const autoSynced = useRef(false);
  useEffect(() => {
    if (connected && !syncedAt && !autoSynced.current) {
      autoSynced.current = true;
      void sync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, syncedAt]);

  return (
    <div className="card mt-4 max-w-xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium text-ink">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Google Calendar
        </span>
        {connected && (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${toneSoft.success}`}>Connected</span>
        )}
      </div>

      {notice && (
        <p
          className={`mb-4 rounded-lg px-3 py-2 text-sm ${
            notice.kind === "ok" ? toneSoft.success : toneSoft.danger
          }`}
        >
          {notice.text}
        </p>
      )}

      {!connected ? (
        <>
          <p className="text-sm text-muted">
            Sync your Google Calendar so your classes, meetings, and commitments sit alongside your coursework —
            for smarter planning around the time you actually have.
          </p>
          <ul className="mt-3 space-y-1 text-xs text-muted">
            <li>• Read-only access to your events — we never edit your calendar.</li>
            <li>• You control your data: disconnect any time and we delete what we synced.</li>
          </ul>
          {configured ? (
            <a href="/api/connections/google/connect" className="btn-primary mt-4 inline-flex">
              Connect Google Calendar
            </a>
          ) : (
            <p className="mt-4 text-xs text-muted">Not available yet — the server needs Google credentials configured.</p>
          )}
        </>
      ) : (
        <>
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Account</dt>
              <dd className="truncate text-ink">{email ?? "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Events synced</dt>
              <dd className="text-ink">{eventCount}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Last synced</dt>
              <dd className="text-ink">{fmt(syncedAt)}</dd>
            </div>
          </dl>
          <div className="mt-4 flex items-center gap-3">
            <button onClick={sync} className="btn-primary" disabled={busy !== null}>
              {busy === "sync" ? "Syncing…" : "Sync now"}
            </button>
            <button onClick={disconnect} className="btn-ghost" disabled={busy !== null}>
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
          <p className="mt-3 text-xs text-muted">Read-only. Disconnecting revokes access and removes synced events.</p>
        </>
      )}
    </div>
  );
}
