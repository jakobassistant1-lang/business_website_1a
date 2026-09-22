import { NextResponse, after } from "next/server";
import { requireActiveUser } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { runSync, type SyncResult } from "@/lib/sync";
import { syncDecision, parseTrigger, type SyncMode } from "@/lib/syncPolicy";
import { messageFor, type CanvasStatus } from "@/lib/messages";

// A full sync walks every course (assignments, announcements, groups, syllabus)
// and can take longer than Vercel's default function budget on a heavy term.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

interface InFlight {
  promise: Promise<SyncResult>;
  startedAt: number;
  mode: SyncMode;
}
/** In-flight runs per user: overlapping requests (Dashboard mount + a focus
 *  event, two tabs) share ONE Canvas walk instead of racing each other. */
const inFlight = new Map<number, InFlight>();
/** When a run last finished per user — throttles "focus" refreshes to one a minute. */
const lastFinishedAt = new Map<number, number>();
const FOCUS_THROTTLE_MS = 60_000;
/** An entry older than this is a run the platform killed before `finally` ran
 *  (maxDuration is 60s): never join it, replace it. */
const IN_FLIGHT_STALE_MS = 55_000;
/** Answer the client before the platform kills us. The run itself is handed to
 *  Next's `after()` so the instance stays alive until it settles; if the
 *  platform still kills it, the 55s stale guard above is what keeps later
 *  requests from joining a dead entry. */
const ROUTE_DEADLINE_MS = 50_000;

// The maps are per-process: on Vercel they only coalesce within a warm instance.
// That's best-effort by design — a duplicate run is wasteful, never wrong.

const STATUSES: ReadonlySet<string> = new Set(["valid", "invalid_token", "bad_domain", "unreachable", "insufficient_scope", "error"]);

/** Race a run against the route's own deadline: the timeout answers with a
 *  stale-but-safe result (cache kept, FR-7) tagged `skipped: "timeout"` so the
 *  client neither analyzes nor re-renders on it; the run continues under after(). */
function withDeadline(run: Promise<SyncResult>, fallback: SyncResult): Promise<SyncResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<SyncResult>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ROUTE_DEADLINE_MS);
  });
  return Promise.race([run, deadline]).finally(() => clearTimeout(timer));
}

// FR-6: sync on demand. Body is optional JSON `{ trigger }`; the server — not the
// browser — decides whether to run nothing, a quick submission refresh, or a full
// sync (lib/syncPolicy), so a long-lived tab can't get stuck un-synced.
export async function POST(req: Request) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const trigger = parseTrigger(await req.json().catch(() => null));
  const now = Date.now();
  const cred = await prisma.canvasCredential.findUnique({
    where: { userId: user.id },
    select: { syncedAt: true, lastValidationStatus: true },
  });
  const syncedAt = cred?.syncedAt ? cred.syncedAt.toISOString() : null;
  // "Nothing ran" answers still tell the truth about the connection: a stale
  // but broken token is not "Up to date."
  const fresh = (): SyncResult => {
    const status = (cred?.lastValidationStatus && STATUSES.has(cred.lastValidationStatus) ? cred.lastValidationStatus : "valid") as CanvasStatus;
    const ok = status === "valid";
    return { ok, status, message: ok ? "Up to date." : messageFor(status), syncedAt, failedCourses: [], skipped: "fresh" };
  };
  const timedOut = (mode: SyncMode): SyncResult => ({
    ok: false,
    status: "unreachable",
    message: "Canvas is taking longer than usual — showing the last good data.",
    syncedAt,
    failedCourses: [],
    mode,
    skipped: "timeout",
  });

  const mode = syncDecision(trigger, syncedAt, new Date(now));
  if (mode === "skip") return NextResponse.json(fresh());
  if (trigger === "focus") {
    const finished = lastFinishedAt.get(user.id);
    if (finished != null && now - finished < FOCUS_THROTTLE_MS) return NextResponse.json(fresh());
  }

  // Join a run in progress only when it will deliver what we need: a full run
  // covers everything; a quick run only satisfies another quick request. Never
  // join an entry old enough to have been killed by the platform.
  const existing = inFlight.get(user.id);
  const joinable = existing != null && now - existing.startedAt < IN_FLIGHT_STALE_MS && (existing.mode === "full" || mode === "quick");
  if (existing && joinable) {
    const shared = await withDeadline(existing.promise, timedOut(existing.mode));
    return NextResponse.json({ ...shared, skipped: "in_flight" } satisfies SyncResult);
  }

  // An unexpected throw becomes an error result (cache kept) so joiners and a
  // post-deadline settle never surface as an unhandled rejection.
  const failed = (): SyncResult => ({ ok: false, status: "error", message: messageFor("error"), syncedAt, failedCourses: [], mode });
  const entry: InFlight = { promise: runSync(user.id, { mode }).catch(failed), startedAt: now, mode };
  entry.promise = entry.promise.finally(() => {
    if (inFlight.get(user.id) === entry) inFlight.delete(user.id); // never evict a newer run
    lastFinishedAt.set(user.id, Date.now());
  });
  inFlight.set(user.id, entry);
  after(() => entry.promise); // keep the instance alive until the run settles (even past the deadline answer)
  return NextResponse.json(await withDeadline(entry.promise, timedOut(mode)));
}
