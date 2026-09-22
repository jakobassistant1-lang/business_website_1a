// The bounded analysis drain (#129) — the rule the CLIENT runs, and nothing else.
//
// Deliberately DEPENDENCY-FREE: no node builtins, no prisma, no geminiFetch. It is
// imported by "use client" components (useAutoSync, FirstSyncProgress), and the
// rest of lib/analysis.ts reaches node `crypto` for the content hash — importing
// that module from the browser would drag a ~364KB crypto polyfill into the client
// bundle. Keep this file free of imports and the cap stays single-sourced for free.
// lib/analysis.ts re-exports all three names, so server callers need not know.

/** One POST /api/analyze analyzes at most MAX_BATCH (40) rows, so a returning user
 *  with a big backlog needs SEVERAL rounds before the plan is fully ranked. The
 *  client loops — but never more than this many times per page visit (6 x 40 = 240
 *  assignments), because one shared GEMINI_API_KEY serves every user and its quota
 *  is a known ceiling (#126). ONE number for every drain loop; the server enforces
 *  its own per-user throttle as well. */
export const MAX_ANALYZE_ROUNDS = 6;

/** The fields a drain round reads off POST /api/analyze. `unknown` because it is
 *  parsed JSON from the network — never trusted to be the declared shape. */
export interface AnalyzeRoundResponse {
  analyzed?: unknown;
  remaining?: unknown;
  done?: unknown;
}

/** Pure drain rule: the round at 0-based index `round` just answered `res` — fire
 *  another POST? Stops at the cap, on `done`, on a round that analyzed nothing
 *  (server idle, AI unavailable, or throttled), and on a null body (non-OK
 *  response or a thrown fetch). Fails OPEN: any doubt ends the loop.
 *  Exported so the loop is unit-testable without a browser. */
export function shouldContinue(round: number, res: AnalyzeRoundResponse | null): boolean {
  if (!res || round + 1 >= MAX_ANALYZE_ROUNDS) return false;
  if (res.done === true) return false;
  return typeof res.analyzed === "number" && res.analyzed > 0;
}
