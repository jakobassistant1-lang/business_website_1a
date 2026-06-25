import Link from "next/link";

// Canvas credential problems that genuinely need the student to RECONNECT (a bad or
// revoked token / missing scope) — distinct from a transient sync hiccup, which just
// retries on its own. Mirrors the `credentialError` set in lib/sync.ts.
const NEEDS_RECONNECT = new Set(["invalid_token", "insufficient_scope"]);

/** App-wide banner (#65): clearly flags an expired/invalid Canvas connection and
 *  offers a one-step reconnect. Renders nothing for a healthy connection or a merely
 *  transiently-stale one — only a real token/scope problem the student must fix. */
export function ConnectionAlert({ status }: { status: string | null }) {
  if (!status || !NEEDS_RECONNECT.has(status)) return null;
  const msg =
    status === "insufficient_scope"
      ? "Your Canvas access token is missing a permission Navo needs, so your plan can’t stay up to date."
      : "Your Canvas connection expired or was disconnected — your plan may be out of date until you reconnect.";
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger-soft/40 px-4 py-3">
      <p className="text-sm font-medium text-ink">
        <span className="mr-1.5 font-semibold text-danger" aria-hidden>
          ⚠
        </span>
        {msg}
      </p>
      <Link href="/connections" className="btn-primary shrink-0 text-sm">
        Reconnect Canvas →
      </Link>
    </div>
  );
}
