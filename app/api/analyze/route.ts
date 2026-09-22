import { NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/access";
import { runAnalysis } from "@/lib/analysisStore";
import { rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// --- per-user throttle (#129) ---
// The client now DRAINS (several POSTs per visit), and every user shares one
// GEMINI_API_KEY whose quota is a known ceiling (#126). A stuck or hostile client
// must not be able to spend it, so the server caps the rounds too — via the ONE
// shared limiter (lib/rateLimit, #128), never a private copy: best-effort and per
// serverless instance, a backstop rather than a global quota. Its own bucket, so
// it shares no budget with the auth speed-bumps. Deliberately above the client's
// MAX_ANALYZE_ROUNDS so an honest visit is never cut short.
const ANALYZE_RATE = { limit: 8, windowMs: 60_000 };

// POST /api/analyze — analyze the next batch of the user's un-analyzed assignments
// (effort + summary) and persist the results. Lazy + idempotent + fails open;
// called post-mount from the Plan page, never on the server render path.
// Returns counts only: { analyzed, remaining, done } (+ the legacy ok/skipped).
// `remaining` is the backlog left AFTER this batch, so the client knows whether to
// run another round; `done` (or a 0 `analyzed`) ends the drain.
export async function POST() {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // remaining: -1 = "unknown, stop asking" — the client stops on `done` anyway.
  if (!rateLimit("analyze", String(user.id), ANALYZE_RATE).allowed) {
    return NextResponse.json({ analyzed: 0, remaining: -1, done: true }, { status: 429 });
  }
  const result = await runAnalysis(user.id);
  return NextResponse.json(result);
}
