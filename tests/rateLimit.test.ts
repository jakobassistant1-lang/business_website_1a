// lib/rateLimit — the one shared auth speed-bump (#128). Pure math with an
// injected clock; each test uses its own bucket so the module-scope Map is
// never shared between cases.
import { describe, it, expect } from "vitest";
import { rateLimit, peekRateLimit, rateLimitEntryCount, ipOf } from "@/lib/rateLimit";

const OPTS = { limit: 3, windowMs: 60_000 };

describe("rateLimit", () => {
  it("allows exactly `limit` hits in a window, then refuses", () => {
    const b = "t-basic";
    expect(rateLimit(b, "k", OPTS, 1000)).toEqual({ allowed: true, remaining: 2, retryAfterSec: 0 });
    expect(rateLimit(b, "k", OPTS, 1000)).toEqual({ allowed: true, remaining: 1, retryAfterSec: 0 });
    expect(rateLimit(b, "k", OPTS, 1000)).toEqual({ allowed: true, remaining: 0, retryAfterSec: 0 });
    const fourth = rateLimit(b, "k", OPTS, 1000);
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
  });

  it("retryAfterSec counts whole seconds to the END of the window (started at the first hit)", () => {
    const b = "t-retry";
    for (let i = 0; i < 3; i++) rateLimit(b, "k", OPTS, 10_000);
    // Window ends at 70_000. Refused at 30_500 → 39.5s → rounded up to 40.
    expect(rateLimit(b, "k", OPTS, 30_500).retryAfterSec).toBe(40);
    // Never reports 0 while refused, even at the very end of the window.
    expect(rateLimit(b, "k", OPTS, 70_000).retryAfterSec).toBe(1);
  });

  it("rolls over: the first hit after the window ends starts a fresh window", () => {
    const b = "t-roll";
    for (let i = 0; i < 4; i++) rateLimit(b, "k", OPTS, 0);
    expect(rateLimit(b, "k", OPTS, 60_000).allowed).toBe(false); // now == resetAt → still inside
    const fresh = rateLimit(b, "k", OPTS, 60_001);
    expect(fresh).toEqual({ allowed: true, remaining: 2, retryAfterSec: 0 });
  });

  it("keys are independent across keys AND across buckets", () => {
    for (let i = 0; i < 4; i++) rateLimit("t-a", "k1", OPTS, 0);
    expect(rateLimit("t-a", "k1", OPTS, 0).allowed).toBe(false);
    expect(rateLimit("t-a", "k2", OPTS, 0).allowed).toBe(true); // other key
    expect(rateLimit("t-b", "k1", OPTS, 0).allowed).toBe(true); // other bucket, same key
  });

  it("matches the pre-refactor route semantics: 10 per 15 min → the 11th is refused", () => {
    const opts = { limit: 10, windowMs: 15 * 60_000 };
    let last = { allowed: true, remaining: 0, retryAfterSec: 0 };
    for (let i = 0; i < 10; i++) {
      last = rateLimit("t-legacy", "ip", opts, 0);
      expect(last.allowed).toBe(true);
    }
    expect(last.remaining).toBe(0);
    const eleventh = rateLimit("t-legacy", "ip", opts, 0);
    expect(eleventh.allowed).toBe(false);
    expect(eleventh.retryAfterSec).toBe(900);
  });
});

describe("peekRateLimit", () => {
  it("never records a hit and refuses only once the window already holds `limit` hits", () => {
    const b = "t-peek";
    expect(peekRateLimit(b, "k", OPTS, 0)).toEqual({ allowed: true, remaining: 3, retryAfterSec: 0 });
    expect(peekRateLimit(b, "k", OPTS, 0)).toEqual({ allowed: true, remaining: 3, retryAfterSec: 0 }); // unchanged
    rateLimit(b, "k", OPTS, 0);
    rateLimit(b, "k", OPTS, 0);
    expect(peekRateLimit(b, "k", OPTS, 0)).toEqual({ allowed: true, remaining: 1, retryAfterSec: 0 });
    rateLimit(b, "k", OPTS, 0); // 3rd hit — allowed, but the bucket is now full
    const full = peekRateLimit(b, "k", OPTS, 30_000);
    expect(full).toEqual({ allowed: false, remaining: 0, retryAfterSec: 30 });
    expect(peekRateLimit(b, "k", OPTS, 60_001).allowed).toBe(true); // window over
  });
});

describe("hard cap on live entries", () => {
  it("stays bounded at 5000 and evicts the oldest windows first", () => {
    const b = "t-cap";
    const opts = { limit: 1, windowMs: 100_000 };
    const before = rateLimitEntryCount();
    // Fill well past the cap with distinct keys whose windows all end later
    // than `now`, so only the oldest-by-resetAt eviction can make room.
    for (let i = 0; i < 6000; i++) rateLimit(b, `k${i}`, opts, i);
    expect(rateLimitEntryCount()).toBeLessThanOrEqual(5000);
    expect(rateLimitEntryCount()).toBeGreaterThan(before);
    // The newest key survived; the very oldest was evicted (its state is gone,
    // so a fresh hit is allowed again — best-effort by design).
    expect(peekRateLimit(b, "k5999", opts, 6000).allowed).toBe(false);
    expect(peekRateLimit(b, "k0", opts, 6000).allowed).toBe(true);
  });
});

describe("ipOf", () => {
  const req = (headers: Record<string, string>) => new Request("http://x/", { headers });

  it("prefers x-real-ip (what Vercel sets) over x-forwarded-for", () => {
    expect(ipOf(req({ "x-real-ip": " 198.51.100.4 ", "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("198.51.100.4");
    expect(ipOf(req({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
  });

  it("falls back to the FIRST hop of x-forwarded-for, trimmed, when x-real-ip is absent or empty", () => {
    expect(ipOf(req({ "x-forwarded-for": " 203.0.113.9 , 10.0.0.1, 10.0.0.2" }))).toBe("203.0.113.9");
    expect(ipOf(req({ "x-real-ip": "", "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it('is "unknown" with neither header', () => {
    expect(ipOf(req({}))).toBe("unknown");
  });
});
