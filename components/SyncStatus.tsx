"use client";

// THE Canvas sync indicator (#136). One small state machine, exactly ONE visible
// state at a time, in this priority:
//   syncing → error (the sync warning) → not connected → never checked
//     → reconnect (the connection is broken) → up to date / last checked
// plus the freshness line "Last checked Canvas {relative time}". Before this, the
// Calendar's pill came from server data while "Syncing…" and warnings were client
// state, so "Up to date" could sit beside "Syncing…" or an error. The Calendar
// header and the Dashboard both render this, fed by useAutoSync.
//
// "Up to date" is a claim about AGE: only while the last check is younger than
// the auto-sync freshness threshold (lib/syncPolicy.MOUNT_FRESH_MS — the one
// number). Older than that, a sync is normally about to run (useAutoSync starts
// in "Checking Canvas…" on first paint when it will); if it isn't, the line just
// says when Canvas was last checked, without the claim.
//
// Tone (the Honest Tone rule): a failed refresh is a quiet NEUTRAL line — never
// red; the cached data on screen is still the last good data.

import { useState } from "react";
import Link from "next/link";
import { LocalRelativeTime } from "@/components/LocalRelativeTime";
import { MOUNT_FRESH_MS } from "@/lib/syncPolicy";

export type SyncState = "syncing" | "error" | "not_connected" | "never" | "reconnect" | "fresh" | "aging";

export interface SyncInputs {
  syncing: boolean;
  /** The sync warning from useAutoSync (null = the last run was fine). */
  warning: string | null;
  connected: boolean;
  /** When Navo last checked Canvas (CalendarData.lastCheckedAt). */
  lastCheckedAt: string | null | undefined;
  /** CalendarData.stale: the saved Canvas connection is no longer valid. */
  stale: boolean;
}

/** The ONE visible state. Pure — unit-tested in tests/syncStatus.test.ts. */
export function syncState(s: SyncInputs, now: number): SyncState {
  if (s.syncing) return "syncing";
  if (s.warning) return "error";
  if (!s.connected) return "not_connected";
  if (!s.lastCheckedAt) return "never";
  if (s.stale) return "reconnect";
  const t = new Date(s.lastCheckedAt).getTime();
  return Number.isFinite(t) && now - t < MOUNT_FRESH_MS ? "fresh" : "aging";
}

/** The state's own words ("" when the freshness line says it all). */
export function syncStateText(state: SyncState, warning: string | null): string {
  switch (state) {
    case "syncing":
      return "Checking Canvas…";
    case "error":
      return warning ?? "Couldn’t reach Canvas just now — showing the last good data.";
    case "not_connected":
      return "Canvas isn’t connected";
    case "never":
      return "Canvas hasn’t been checked yet";
    case "reconnect":
      return "Reconnect Canvas";
    case "fresh":
      return "Up to date";
    case "aging":
      return "";
  }
}

/** States that also print "Last checked Canvas …" (when there's a time to print). */
export function showsFreshness(state: SyncState): boolean {
  return state === "error" || state === "reconnect" || state === "fresh" || state === "aging";
}

const DOT: Record<SyncState, string> = {
  syncing: "bg-accent motion-safe:animate-pulse",
  error: "bg-muted/60",
  not_connected: "bg-muted/60",
  never: "bg-muted/60",
  reconnect: "bg-muted/60",
  fresh: "bg-success",
  aging: "bg-muted/60",
};

/** `onRetry` powers the error state's "Try again" button (and, with `manual`,
 *  a quiet "Check now" button in the calm states — the Calendar header). */
export function SyncStatus({
  inputs,
  onRetry,
  manual = false,
  className = "",
}: {
  inputs: SyncInputs;
  onRetry?: () => void;
  manual?: boolean;
  className?: string;
}) {
  const [now] = useState(() => Date.now());
  const state = syncState(inputs, now);
  const text = syncStateText(state, inputs.warning);
  const freshness = showsFreshness(state) && !!inputs.lastCheckedAt;
  const retry = state === "error" && onRetry;
  const check = manual && onRetry && (state === "fresh" || state === "aging" || state === "never" || state === "syncing");
  return (
    <div className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 ${className}`}>
      {/* Always mounted, so a change of state is announced (a region that mounts
          with its text often isn't). */}
      <p role="status" aria-live="polite" className="flex min-w-0 items-center gap-2 text-[13px] text-muted">
        <span aria-hidden className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${DOT[state]}`} />
        <span className="min-w-0">
          {state === "reconnect" ? (
            <Link href="/connections" className="max-md:tap font-medium text-accent hover:underline">
              {text}
            </Link>
          ) : (
            text
          )}
          {freshness && (
            <>
              {text ? " · " : ""}Last checked Canvas <LocalRelativeTime iso={inputs.lastCheckedAt!} />
            </>
          )}
        </span>
        {retry && (
          <button type="button" onClick={onRetry} className="max-md:tap shrink-0 font-medium text-accent hover:underline">
            Try again
          </button>
        )}
      </p>
      {check && (
        <button type="button" onClick={onRetry} disabled={state === "syncing"} className="btn-ghost max-md:tap text-sm disabled:opacity-50">
          Check now
        </button>
      )}
    </div>
  );
}
