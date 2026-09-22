"use client";

// The ONE client-side Canvas auto-sync (Dashboard + Calendar). The browser only
// says WHY it's asking (mount / focus / manual); /api/sync decides whether that
// means nothing, a quick submission refresh, or a full sync (lib/syncPolicy —
// the same pure rule is consulted here first so a fresh page costs no request).
// No sessionStorage flag: Chrome restores sessionStorage when a tab is
// restored, which left long-lived tabs un-synced for days.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { syncDecision, type SyncTrigger } from "@/lib/syncPolicy";

/** A tab hidden/unfocused for at least this long asks for a quick refresh when
 *  it comes back (long enough to have submitted something in Canvas). */
const FOCUS_AFTER_HIDDEN_MS = 60_000;

const UNREACHABLE = "Couldn't reach Canvas just now — showing the last good data.";

interface SyncResponse {
  ok?: unknown;
  message?: unknown;
  failedCourses?: unknown;
  skipped?: unknown;
}

export function useAutoSync(opts: { connected: boolean; syncedAt: string | null; demo?: boolean }): {
  syncing: boolean;
  warning: string | null;
  runManual: () => Promise<void>;
} {
  const { connected, syncedAt, demo = false } = opts;
  const enabled = connected && !demo; // demo runs on mock data — never touch the network
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const inFlight = useRef(false); // never overlap two runs from this tab
  const didMount = useRef(false);
  const hiddenAt = useRef<number | null>(null);
  const bounced = useRef(false); // at most one hard reload per mount on a 401

  const run = useCallback(
    async (trigger: SyncTrigger, analyze: boolean) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setSyncing(true);
      try {
        const res = await fetch("/api/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trigger }),
        });
        if (res.status === 401) {
          // Not a Canvas problem: the session is gone OR the account is now
          // blocked by billing (#119 — past_due/canceled/unpaid). Client-side
          // <Link> navigations don't re-run the (app) layout gate, so force one
          // full load of / which re-runs it and lands on the right screen.
          if (!bounced.current) {
            bounced.current = true;
            window.location.assign("/");
          }
          return;
        }
        const body = res.ok ? ((await res.json().catch(() => null)) as SyncResponse | null) : null;
        if (!body || typeof body !== "object") {
          // 5xx / gateway timeout / unparseable: the sync didn't happen. Say so
          // quietly — the cached data on screen is still the last good data.
          setWarning(UNREACHABLE);
          return;
        }
        const failed = Array.isArray(body.failedCourses) ? body.failedCourses.length : 0;
        if (body.ok === false) {
          setWarning(typeof body.message === "string" ? body.message : UNREACHABLE);
        } else if (failed > 0) {
          setWarning(`Couldn't refresh ${failed} ${failed === 1 ? "class" : "classes"} from Canvas — showing the last good data.`);
        } else {
          setWarning(null);
        }
        // Nothing new landed (server says fresh / joined a run / timed out) →
        // no analysis pass and no RSC re-render; the warning above still stands.
        if (body.skipped) return;
        // Effort/summary analysis of anything new — only after a mount/manual
        // sync; a focus refresh is submissions-only and shouldn't spend an AI call.
        if (analyze) await fetch("/api/analyze", { method: "POST" }).catch(() => {});
        router.refresh();
      } catch {
        setWarning(UNREACHABLE); // network failure: cache stays on screen (FR-7)
      } finally {
        inFlight.current = false;
        setSyncing(false);
      }
    },
    [router],
  );

  // Mount: once per component mount. The same rule the server applies runs here
  // first (server-rendered syncedAt): a page younger than 10 minutes costs no
  // request at all; otherwise the server re-checks and runs a full sync.
  useEffect(() => {
    if (!enabled || didMount.current) return;
    didMount.current = true;
    if (syncDecision("mount", syncedAt, new Date()) === "skip") return;
    void run("mount", true);
  }, [enabled, syncedAt, run]);

  // Coming back to the tab after ≥ 60s away → quick submission refresh.
  // visibilitychange is the primary signal; window blur/focus is the fallback
  // for window switches that don't change visibility.
  useEffect(() => {
    if (!enabled) return;
    const away = () => {
      if (hiddenAt.current == null) hiddenAt.current = Date.now();
    };
    const back = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const since = hiddenAt.current;
      if (since == null) return;
      hiddenAt.current = null;
      if (Date.now() - since < FOCUS_AFTER_HIDDEN_MS) return;
      void run("focus", false);
    };
    const onVisibility = () => (document.visibilityState === "hidden" ? away() : back());
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", away);
    window.addEventListener("focus", back);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", away);
      window.removeEventListener("focus", back);
    };
  }, [enabled, run]);

  const runManual = useCallback(async () => {
    if (!enabled) return;
    await run("manual", true);
  }, [enabled, run]);

  return { syncing, warning, runManual };
}
