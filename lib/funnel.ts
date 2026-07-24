// Fire-and-forget funnel logging (#117). One rule: logging can NEVER throw,
// block, or slow a user-facing request — a broken insert costs us a data point,
// never a signup. Query the funnel with:
//   SELECT name, COUNT(DISTINCT COALESCE("userId", id)) AS n
//   FROM "FunnelEvent" WHERE "createdAt" >= NOW() - INTERVAL '7 days'
//   GROUP BY name ORDER BY MIN("createdAt");
import { prisma } from "./prisma";

export type FunnelEventName =
  | "signup_created"
  | "demo_completed"
  | "checkout_started"
  | "checkout_completed"
  | "canvas_connected"
  | "first_sync_ok"
  | "first_sync_failed"
  | "first_plan_rendered"
  | "trial_converted"
  | "canceled";

type MinimalClient = { funnelEvent: { create(args: { data: { userId: number | null; name: string; meta: string | null } }): Promise<unknown> } };

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
