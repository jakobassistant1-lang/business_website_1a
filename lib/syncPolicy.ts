// The Canvas sync POLICY — pure and node-free so the browser hook
// (components/useAutoSync) and the route (/api/sync) share ONE rule instead of
// each keeping a copy. No prisma, no fetch, no node: imports here.

/** "full" = courses + assignments + announcements + groups + syllabus/late policy
 *  (today's sync). "quick" = assignments (incl. submissions) for the courses we
 *  already know — cheap enough to run every time the student comes back to the
 *  tab, so a submission made in Canvas shows up within a minute. */
export type SyncMode = "full" | "quick";

/** Why the client asked for a sync. The server maps it to a mode via syncDecision. */
export type SyncTrigger = "mount" | "focus" | "manual";

/** A full sync younger than this is "fresh": a page mount doesn't re-run it. */
export const MOUNT_FRESH_MS = 10 * 60 * 1000;

/**
 * The ONE sync policy (unit-tested in tests/syncPolicy.test.ts):
 *   manual → always a full sync (the student pressed the button);
 *   mount  → full, unless the last full sync is under 10 minutes old → skip;
 *   focus  → quick (submission refresh); the client + route throttle how often.
 * `syncedAtIso` is CanvasCredential.syncedAt — the last FULL sync — so a run of
 * quick syncs never makes a stale account look fresh.
 */
export function syncDecision(trigger: SyncTrigger, syncedAtIso: string | null, now: Date): SyncMode | "skip" {
  if (trigger === "manual") return "full";
  if (trigger === "focus") return "quick";
  if (!syncedAtIso) return "full";
  const t = new Date(syncedAtIso).getTime();
  if (Number.isNaN(t)) return "full";
  return now.getTime() - t < MOUNT_FRESH_MS ? "skip" : "full";
}

/** The request body's trigger; anything missing/invalid means "manual" (today's
 *  callers post no body and expect a full sync). */
export function parseTrigger(body: unknown): SyncTrigger {
  const t = typeof body === "object" && body !== null ? (body as { trigger?: unknown }).trigger : undefined;
  return t === "mount" || t === "focus" || t === "manual" ? t : "manual";
}
