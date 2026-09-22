// Shared best-effort rate limiter (#128). ONE implementation for every auth
// speed-bump (login, signup, forgot-password) — single-source rule: don't copy
// this into a route, call it.
//
// Scope/guarantees: the counters live in a module-scope Map, so they are
// per serverless instance and reset on cold start. This is NOT a shared-store
// limiter — it slows scripted abuse against one instance; it does not enforce a
// global quota. Same trade-off the per-route copies made before they were
// unified here. Window semantics (kept identical to those copies): the window
// starts at the first hit; the first `limit` hits in it are allowed and the
// (limit+1)th is refused; once `now` passes the window end the next hit starts
// a fresh window.
//
// Two entry points: `rateLimit` records a hit and answers (signup/forgot count
// every request); `peekRateLimit` only answers (login checks before the bcrypt
// compare and records with `rateLimit` only on FAILURE, so a correct password
// always succeeds and a legit user can't be locked out by junk traffic).

type Entry = { count: number; resetAt: number };

const hits = new Map<string, Entry>();
/** Hard cap on live entries. Enforced only when a NEW key would exceed it:
 *  expired entries are swept first, then the oldest (by resetAt) are evicted
 *  down to EVICT_TO so the O(n log n) pass is amortised, not per request. */
const MAX_ENTRIES = 5000;
const EVICT_TO = 4500;

export type RateLimitOpts = { limit: number; windowMs: number };
export type RateLimitResult = {
  allowed: boolean;
  /** Hits still allowed in the current window (0 once refused). */
  remaining: number;
  /** Whole seconds until the window ends; 0 when allowed. Suitable for a Retry-After header. */
  retryAfterSec: number;
};

function result(e: Entry | undefined, limit: number, now: number, allowed: boolean): RateLimitResult {
  const count = e ? e.count : 0;
  return {
    allowed,
    remaining: Math.max(0, limit - count),
    retryAfterSec: allowed || !e ? 0 : Math.max(1, Math.ceil((e.resetAt - now) / 1000)),
  };
}

function makeRoom(now: number) {
  if (hits.size < MAX_ENTRIES) return;
  for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
  if (hits.size < MAX_ENTRIES) return;
  const oldestFirst = [...hits.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
  for (let i = 0; i < oldestFirst.length && hits.size > EVICT_TO; i++) hits.delete(oldestFirst[i][0]);
}

/**
 * Record one hit for `key` inside `bucket` and say whether it is allowed.
 * `now` is injectable for tests only — callers use the default.
 */
export function rateLimit(bucket: string, key: string, opts: RateLimitOpts, now = Date.now()): RateLimitResult {
  const { limit, windowMs } = opts;
  const mapKey = `${bucket}:${key}`;
  let e = hits.get(mapKey);
  if (!e || now > e.resetAt) {
    if (!e) makeRoom(now);
    e = { count: 1, resetAt: now + windowMs };
    hits.set(mapKey, e);
  } else {
    e.count += 1;
  }
  return result(e, limit, now, e.count <= limit);
}

/**
 * Answer WITHOUT recording a hit: refused iff the window is live and already
 * holds `limit` hits (i.e. the next `rateLimit` call would be refused).
 */
export function peekRateLimit(bucket: string, key: string, opts: RateLimitOpts, now = Date.now()): RateLimitResult {
  const e = hits.get(`${bucket}:${key}`);
  if (!e || now > e.resetAt) return result(undefined, opts.limit, now, true);
  return result(e, opts.limit, now, e.count < opts.limit);
}

/** Number of live entries (tests / observability only). */
export function rateLimitEntryCount(): number {
  return hits.size;
}

/**
 * Best-effort client IP for keying a limiter: x-real-ip (what Vercel sets for
 * the real client), else the first hop of x-forwarded-for, else "unknown".
 * Callers that key per-IP should treat "unknown" as "no IP bucket" rather than
 * pooling every client into one key. Never trusted for anything but throttling.
 */
export function ipOf(req: Request): string {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || "unknown";
}
