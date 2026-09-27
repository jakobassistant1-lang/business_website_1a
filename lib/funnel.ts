// Fire-and-forget funnel logging (#117). One rule: logging can NEVER throw,
// block, or slow a user-facing request — a broken insert costs us a data point,
// never a signup. Server code always AWAITS these calls (Vercel freezes work
// after the response; tests/funnelAwait.test.ts). Every event, where it fires,
// and the drop-off query live in docs/funnel.md.
import { prisma } from "./prisma";

export type FunnelEventName =
  | "signup_created"
  | "welcome_sent"
  | "trial_ending_sent"
  | "demo_completed"
  | "checkout_started"
  | "checkout_completed"
  | "canvas_connected"
  | "first_sync_ok"
  | "first_sync_failed"
  | "first_plan_rendered"
  | "trial_converted"
  | "payment_failed"
  | "cancel_scheduled"
  | "canceled";

type MinimalClient = { funnelEvent: { create(args: { data: { userId: number | null; name: string; meta: string | null } }): Promise<unknown> } };
type FirstClient = MinimalClient & {
  funnelEvent: { findFirst(args: { where: { userId: number; name: { in: FunnelEventName[] } }; select: { id: true } }): Promise<unknown> };
};

/** "First" milestones and their families: a user gets at most ONE event per
 *  family, ever. The first completed sync counts whatever its outcome, so
 *  first_sync_ok and first_sync_failed share a family. */
const FIRST_FAMILIES = {
  first_sync_ok: ["first_sync_ok", "first_sync_failed"],
  first_sync_failed: ["first_sync_ok", "first_sync_failed"],
  first_plan_rendered: ["first_plan_rendered"],
} as const satisfies Partial<Record<FunnelEventName, readonly FunnelEventName[]>>;
export type FirstEventName = keyof typeof FIRST_FAMILIES;

/** The day the first_* milestones shipped (#111). Users created before it are
 *  already activated, so page-level "first" checks skip them without a query. */
export const FUNNEL_FIRSTS_SINCE = "2026-09-27";
/** True when a user signed up on/after FUNNEL_FIRSTS_SINCE (UTC midnight). */
export function inFirstsCohort(createdAt: Date): boolean {
  return createdAt.getTime() >= Date.parse(FUNNEL_FIRSTS_SINCE);
}

/** Log an event and move on. Await it or don't — it resolves either way. */
export async function logEvent(
  name: FunnelEventName,
  userId?: number | null,
  meta?: Record<string, unknown>,
  client: MinimalClient = prisma,
): Promise<void> {
  try {
    await client.funnelEvent.create({
      data: { userId: userId ?? null, name, meta: meta ? JSON.stringify(meta) : null },
    });
  } catch {
    // Swallowed by design — see module comment.
  }
}

/** Log a "first" milestone only if this user has no earlier event in its
 *  family (one indexed findFirst, then the insert). Never throws. Two truly
 *  concurrent first calls can both pass the check — rare, and the funnel counts
 *  DISTINCT users, so a duplicate row never skews it. */
export async function logFirst(
  name: FirstEventName,
  userId: number,
  meta?: Record<string, unknown>,
  client: FirstClient = prisma,
): Promise<void> {
  try {
    const prior = await client.funnelEvent.findFirst({
      where: { userId, name: { in: [...FIRST_FAMILIES[name]] } },
      select: { id: true },
    });
    if (prior) return;
  } catch {
    return; // Can't tell whether it's the first — skip rather than risk a duplicate.
  }
  await logEvent(name, userId, meta, client);
}
