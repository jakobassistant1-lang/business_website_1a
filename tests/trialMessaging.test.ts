// #110: honest "7-day free trial" messaging. The banner's day math AND its
// wording are pure helpers, so every branch (cancel scheduled, last day, spent
// trial, missing price) is unit-tested rather than eyeballed. Grep guards make
// sure no surface can drift back to free-forever wording or a hardcoded price,
// and that the signup terms line only renders when the server sent terms.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, sep } from "path";
import { TRIAL_DAYS, isTrialing, trialBannerText, trialDaysLeft, SUBSCRIPTION_STATUSES } from "@/lib/subscription";
import { trialDaysFor } from "@/lib/stripe";
import {
  PRICE_RETRY_AFTER_MS,
  PRICE_TIMEOUT_MS,
  loadTrialPrice,
  noteNullPrice,
  priceFetchSuppressed,
  resetPriceBackoff,
  withTimeout,
} from "@/lib/trialTerms";

const now = new Date("2026-09-21T12:00:00Z");
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000);
// Never the real price — the real one must only ever come from Stripe.
const PRICE = "$X.XX/month";

describe("trialDaysLeft — the banner's day math", () => {
  it("no end date → null (show nothing rather than a made-up number)", () => {
    expect(trialDaysLeft(null, now)).toBeNull();
    expect(trialDaysLeft(undefined, now)).toBeNull();
    expect(trialDaysLeft("", now)).toBeNull();
    expect(trialDaysLeft("not-a-date", now)).toBeNull();
  });
  it("already past → 0, never a negative count", () => {
    expect(trialDaysLeft(inDays(-0.1), now)).toBe(0);
    expect(trialDaysLeft(inDays(-3), now)).toBe(0);
    expect(trialDaysLeft(now, now)).toBe(0);
  });
  it("rounds UP: half a day left still reads as 1 (the 'last day' case)", () => {
    expect(trialDaysLeft(inDays(0.5), now)).toBe(1);
    expect(trialDaysLeft(inDays(0.01), now)).toBe(1);
    expect(trialDaysLeft(inDays(1), now)).toBe(1);
  });
  it("6.9 days left reads as 7, not 6", () => {
    expect(trialDaysLeft(inDays(6.9), now)).toBe(7);
    expect(trialDaysLeft(inDays(6.1), now)).toBe(7);
    expect(trialDaysLeft(inDays(6), now)).toBe(6);
    expect(trialDaysLeft(inDays(TRIAL_DAYS), now)).toBe(TRIAL_DAYS);
  });
  it("accepts an ISO string exactly like a Date (Prisma vs. serialized props)", () => {
    expect(trialDaysLeft(inDays(2.5).toISOString(), now)).toBe(3);
    expect(trialDaysLeft(inDays(2.5), now)).toBe(3);
  });
  it("N <= 1 is the 'Last day' copy boundary; N >= 2 is the plural count", () => {
    expect(trialDaysLeft(inDays(0.9), now)).toBeLessThanOrEqual(1);
    expect(trialDaysLeft(inDays(1.1), now)).toBe(2);
  });
});

describe("trialBannerText — the banner's wording", () => {
  it("counts the days down and names the price that follows", () => {
    expect(trialBannerText({ daysLeft: 5, price: PRICE, cancelAtPeriodEnd: false })).toBe(
      `5 days left in your free trial — then ${PRICE}.`,
    );
    expect(trialBannerText({ daysLeft: TRIAL_DAYS, price: PRICE })).toBe(`7 days left in your free trial — then ${PRICE}.`);
  });
  it("one day left → the 'Last day' wording, never '1 days'", () => {
    const t = trialBannerText({ daysLeft: 1, price: PRICE });
    expect(t).toBe(`Last day of your free trial — then ${PRICE}.`);
    expect(t).not.toContain("1 days");
  });
  it("a scheduled cancel is NEVER told about a future charge — the plan just ends", () => {
    expect(trialBannerText({ daysLeft: 4, price: PRICE, cancelAtPeriodEnd: true })).toBe(
      "4 days left in your free trial — your plan ends then and you won’t be charged.",
    );
    expect(trialBannerText({ daysLeft: 1, price: PRICE, cancelAtPeriodEnd: true })).toBe(
      "Last day of your free trial — your plan ends then and you won’t be charged.",
    );
    for (const daysLeft of [1, 3, 7]) {
      expect(trialBannerText({ daysLeft, price: PRICE, cancelAtPeriodEnd: true })).not.toContain(PRICE);
      expect(trialBannerText({ daysLeft, price: PRICE, cancelAtPeriodEnd: true })).not.toContain("then " + PRICE);
    }
  });
  it("no price (Stripe unreachable) → the clause is dropped, never a guessed number", () => {
    expect(trialBannerText({ daysLeft: 3, price: null })).toBe("3 days left in your free trial.");
    expect(trialBannerText({ daysLeft: 1, price: null })).toBe("Last day of your free trial.");
    expect(trialBannerText({ daysLeft: 3, price: null, cancelAtPeriodEnd: true })).toBe(
      "3 days left in your free trial — your plan ends then and you won’t be charged.",
    );
  });
  it("a spent or unknown trial renders nothing (day 0 = webhook lag; the status flip moves them)", () => {
    for (const cancelAtPeriodEnd of [true, false, null, undefined]) {
      expect(trialBannerText({ daysLeft: 0, price: PRICE, cancelAtPeriodEnd })).toBeNull();
      expect(trialBannerText({ daysLeft: -2, price: PRICE, cancelAtPeriodEnd })).toBeNull();
      expect(trialBannerText({ daysLeft: null, price: PRICE, cancelAtPeriodEnd })).toBeNull();
    }
  });
  it("never implies the app is free beyond the trial", () => {
    const all = [true, false].flatMap((c) =>
      [1, 3, 7].flatMap((d) => [trialBannerText({ daysLeft: d, price: PRICE, cancelAtPeriodEnd: c }), trialBannerText({ daysLeft: d, price: null, cancelAtPeriodEnd: c })]),
    );
    for (const t of all) {
      expect(t).not.toBeNull();
      expect(t!.toLowerCase()).not.toMatch(/free forever|free plan|no credit card/);
      expect(t).toContain("free trial");
    }
  });
});

describe("isTrialing — the one 'trialing' comparison", () => {
  it("true only for trialing; unknown/null fail closed to none", () => {
    for (const s of SUBSCRIPTION_STATUSES) expect(isTrialing(s)).toBe(s === "trialing");
    expect(isTrialing(null)).toBe(false);
    expect(isTrialing(undefined)).toBe(false);
    expect(isTrialing("weird-future-value")).toBe(false);
  });
});

describe("TRIAL_DAYS is the single source for the trial length", () => {
  it("the Stripe trial param is TRIAL_DAYS, not a second 7", () => {
    expect(TRIAL_DAYS).toBe(7);
    expect(trialDaysFor({ stripeSubscriptionId: null })).toBe(TRIAL_DAYS);
    expect(trialDaysFor({ stripeSubscriptionId: "sub_123" })).toBeUndefined();
  });
  it("lib/stripe.ts reads the constant instead of literalising it", () => {
    const src = readFileSync("lib/stripe.ts", "utf8");
    expect(/import\s*\{[^}]*\bTRIAL_DAYS\b[^}]*\}\s*from\s*"\.\/subscription";/.test(src)).toBe(true);
    expect(src.includes("stripeSubscriptionId ? undefined : TRIAL_DAYS")).toBe(true);
  });
});

// --- the auth doors never wait on Stripe ------------------------------------

describe("withTimeout — a slow Stripe can't hold up /login or /signup", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a hung read resolves null once the deadline passes, not before", async () => {
    let settled: string | null | undefined;
    const done = withTimeout(new Promise<string>(() => {}), PRICE_TIMEOUT_MS).then((v) => {
      settled = v;
    });
    await vi.advanceTimersByTimeAsync(PRICE_TIMEOUT_MS - 1);
    expect(settled).toBeUndefined(); // still waiting — the deadline hasn't hit
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(settled).toBeNull();
  });
  it("a fast read wins and leaves no timer pending", async () => {
    await expect(withTimeout(Promise.resolve(PRICE), PRICE_TIMEOUT_MS)).resolves.toBe(PRICE);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("a rejection becomes null (never throws into the page)", async () => {
    await expect(withTimeout(Promise.reject(new Error("stripe down")), PRICE_TIMEOUT_MS)).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("the deadline is 1.5s", () => {
    expect(PRICE_TIMEOUT_MS).toBe(1500);
  });
});

describe("negative price cache — one slow wait per instance per minute", () => {
  beforeEach(() => resetPriceBackoff());
  afterEach(() => resetPriceBackoff());

  it("nothing is suppressed until a read comes back null", () => {
    expect(priceFetchSuppressed(Date.now())).toBe(false);
  });
  it("a null read suppresses the next attempt for exactly a minute", () => {
    const t0 = 1_700_000_000_000;
    noteNullPrice(t0);
    expect(priceFetchSuppressed(t0)).toBe(true);
    expect(priceFetchSuppressed(t0 + PRICE_RETRY_AFTER_MS - 1)).toBe(true);
    expect(priceFetchSuppressed(t0 + PRICE_RETRY_AFTER_MS)).toBe(false);
    expect(PRICE_RETRY_AFTER_MS).toBe(60_000);
  });
  it("while suppressed, loadTrialPrice returns null WITHOUT touching Stripe", async () => {
    const t0 = 1_700_000_000_000;
    noteNullPrice(t0);
    await expect(loadTrialPrice(t0 + 1)).resolves.toBeNull();
  });
});

// --- grep guards -----------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Tests are allowed to name prices and banned phrases — they're the guard. */
const notATest = (f: string) => !f.split(sep).includes("tests");

/** Comments may document the price FORMAT ("$4.99/month" in a doc block over
 *  formatPrice); shipped copy may not contain it. Strip comments before
 *  matching, leaving `://` in URLs alone. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");
}

/** The price must ALWAYS come from priceDisplay() reading Stripe — never be
 *  typed into a page, component, or lib module. */
const PRICE_PATTERNS: [label: string, re: RegExp][] = [
  ["the literal 4.99", /\b4[.,]99\b/],
  ["a literal $N/mo price", /\$\s?\d+(\.\d\d)?\s*(\/|per)\s*mo/i],
];

describe("grep guard: the price is never hardcoded in app/, components/ or lib/", () => {
  const files = [...walk("app"), ...walk("components"), ...walk("lib")].filter(notATest);
  it("finds the source files", () => {
    expect(files.length).toBeGreaterThan(80);
  });
  for (const [label, re] of PRICE_PATTERNS) {
    it(`no shipped code contains ${label}`, () => {
      expect(files.filter((f) => re.test(stripComments(readFileSync(f, "utf8"))))).toEqual([]);
    });
  }
});

/** Copy that would imply Navo is free (it isn't — card upfront, 7 days, then a
 *  monthly charge). Scoped to the surfaces a student actually reads; lib/
 *  backlog seed text legitimately QUOTES this wording as the thing to remove. */
const BANNED: [label: string, re: RegExp][] = [
  ["free forever", /free\s+forever/i],
  ["forever free", /forever\s+free/i],
  ["free plan", /free\s+plan/i],
  ["no credit card", /no\s+credit\s+card/i],
];

describe("grep guard: no free-forever wording in app/ or components/", () => {
  const files = [...walk("app"), ...walk("components")].filter(notATest);
  it("finds the source files", () => {
    expect(files.length).toBeGreaterThan(50);
  });
  for (const [label, re] of BANNED) {
    it(`no file says "${label}"`, () => {
      expect(files.filter((f) => re.test(readFileSync(f, "utf8")))).toEqual([]);
    });
  }
});

describe("grep guard: the signup terms line renders only when the server sent terms", () => {
  const src = readFileSync("components/AuthFlow.tsx", "utf8");
  const GUARD = 'role === "student" && mode === "signup" && trialTerms && (';
  it("the line sits behind the student+signup+trialTerms guard", () => {
    expect(src.includes(GUARD)).toBe(true);
    const guardAt = src.indexOf(GUARD);
    expect(guardAt).toBeGreaterThan(-1);
    for (const copy of [
      "Free for {trialTerms.trialDays} days, then {trialTerms.price}.",
      "Free for {trialTerms.trialDays} days, then a small monthly fee.",
    ]) {
      expect(src.indexOf(copy)).toBeGreaterThan(guardAt);
    }
  });
  it("the trial length and the price both come from the prop — never typed in", () => {
    expect(/Free for \d/.test(src)).toBe(false);
    expect(/\d+\s*-?\s*day free trial/i.test(src)).toBe(false);
  });
  it("the prop is optional, so every other caller renders exactly as before", () => {
    expect(src.includes("trialTerms?: TrialTerms | null")).toBe(true);
  });
  it("the shared type comes from lib (lib must never import a 'use client' module)", () => {
    expect(src.includes('import type { TrialTerms } from "@/lib/subscription";')).toBe(true);
    const terms = readFileSync("lib/trialTerms.ts", "utf8");
    expect(terms.includes("@/components/")).toBe(false);
  });
});

describe("grep guard: TrialBanner is inert unless billing is on and the trial is live", () => {
  const src = readFileSync("components/TrialBanner.tsx", "utf8");
  it("gates on billingEnabled, admin, isTrialing, a real end date, and days remaining", () => {
    expect(src.includes("if (!billingEnabled() || isAdmin) return null;")).toBe(true);
    expect(src.includes("if (!isTrialing(user.subscriptionStatus)) return null;")).toBe(true);
    expect(src.includes("if (daysLeft === null || daysLeft <= 0) return null;")).toBe(true);
  });
  it("holds no copy of its own — every string comes from trialBannerText", () => {
    expect(src.includes("trialBannerText(")).toBe(true);
    expect(src.includes("free trial")).toBe(false);
  });
  it("reads the price through the timed, negatively-cached helper", () => {
    expect(src.includes("await loadTrialPrice()")).toBe(true);
    expect(src.includes("priceDisplay(")).toBe(false);
  });
  it("is not a client component (no bundle, no price in client JS)", () => {
    expect(src.includes('"use client"')).toBe(false);
  });
});
