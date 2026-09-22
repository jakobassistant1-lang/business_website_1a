// #119: per-request access gating. The pure rule (accessDecision) gets a full
// truth table; grep guards make sure every data API route goes through
// requireActiveUser and the (app) layout goes through accessDecision — so a new
// route or a "quick" inline status check can't quietly bypass the gate.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { accessDecision, DECISION_PATH, needsCheckout, SUBSCRIPTION_STATUSES, type AccessDecision } from "@/lib/subscription";
import { portalReturnUrl, trialDaysFor, statusFromStripeSubscription, reconcileFields } from "@/lib/stripe";

const ON = true;
const OFF = false;
const onboarded = new Date("2026-09-01T00:00:00Z");
const u = (subscriptionStatus: string | null | undefined, onboardedAt: Date | string | null = onboarded) => ({ subscriptionStatus, onboardedAt });

describe("accessDecision — full truth table", () => {
  it("billing flag off → allow for EVERY status, onboarded or not (prod unchanged while unset)", () => {
    for (const s of [...SUBSCRIPTION_STATUSES, "weird", null, undefined]) {
      expect(accessDecision(u(s), OFF, false)).toBe("allow");
      expect(accessDecision(u(s, null), OFF, false)).toBe("allow");
    }
  });
  it("admins → allow regardless of status or onboarding", () => {
    for (const s of [...SUBSCRIPTION_STATUSES, "weird", null]) {
      expect(accessDecision(u(s), ON, true)).toBe("allow");
      expect(accessDecision(u(s, null), ON, true)).toBe("allow");
    }
  });
  it("grandfathered / trialing / active → allow (never redirected)", () => {
    for (const s of ["grandfathered", "trialing", "active"]) {
      expect(accessDecision(u(s), ON, false)).toBe("allow");
      expect(accessDecision(u(s, null), ON, false)).toBe("allow");
    }
  });
  it("past_due → past_due screen; canceled → canceled screen (onboarding irrelevant)", () => {
    expect(accessDecision(u("past_due"), ON, false)).toBe("past_due");
    expect(accessDecision(u("past_due", null), ON, false)).toBe("past_due");
    expect(accessDecision(u("canceled"), ON, false)).toBe("canceled");
    expect(accessDecision(u("canceled", null), ON, false)).toBe("canceled");
  });
  it("none → demo first, then the card step once onboarded", () => {
    expect(accessDecision(u("none", null), ON, false)).toBe("demo");
    expect(accessDecision(u("none"), ON, false)).toBe("checkout");
    expect(accessDecision(u("none", "2026-09-01T00:00:00Z"), ON, false)).toBe("checkout"); // string date counts
  });
  it("unknown / null / undefined status fails CLOSED like none (never silent access)", () => {
    for (const s of ["weird-future-value", "", null, undefined]) {
      expect(accessDecision(u(s, null), ON, false)).toBe("demo");
      expect(accessDecision(u(s), ON, false)).toBe("checkout");
    }
  });
  it("every status maps to exactly one decision", () => {
    const seen: Record<string, AccessDecision> = {};
    for (const s of SUBSCRIPTION_STATUSES) seen[s] = accessDecision(u(s), ON, false);
    expect(seen).toEqual({ grandfathered: "allow", none: "checkout", trialing: "allow", active: "allow", past_due: "past_due", canceled: "canceled" });
  });
});

describe("needsCheckout (card step)", () => {
  it("none AND canceled need checkout (a canceled student restarts by paying again); nothing else does", () => {
    for (const s of SUBSCRIPTION_STATUSES) expect(needsCheckout(s)).toBe(s === "none" || s === "canceled");
  });
});

describe("DECISION_PATH", () => {
  it("covers every non-allow decision with a distinct absolute path, and nothing under /(app)", () => {
    const decisions: Exclude<AccessDecision, "allow">[] = ["demo", "checkout", "past_due", "canceled"];
    expect(Object.keys(DECISION_PATH).sort()).toEqual([...decisions].sort());
    const paths = decisions.map((d) => DECISION_PATH[d]);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of paths) expect(p.startsWith("/")).toBe(true);
    expect(DECISION_PATH).toEqual({ demo: "/demo", checkout: "/welcome/card", past_due: "/billing/past-due", canceled: "/billing/canceled" });
  });
});

describe("portal return url", () => {
  it("lands on the past-due screen of the given origin, tolerating a trailing slash", () => {
    expect(portalReturnUrl("https://app.navolearning.com")).toBe("https://app.navolearning.com/billing/past-due?from=portal");
    expect(portalReturnUrl("https://app.navolearning.com/")).toBe("https://app.navolearning.com/billing/past-due?from=portal");
    expect(portalReturnUrl("http://localhost:3000")).toBe("http://localhost:3000/billing/past-due?from=portal");
  });
});

describe("trialDaysFor — the free week is for first-timers only", () => {
  it("never subscribed → 7 days; any subscription on file (canceled restart) → no trial param at all", () => {
    expect(trialDaysFor({ stripeSubscriptionId: null })).toBe(7);
    expect(trialDaysFor({ stripeSubscriptionId: "sub_123" })).toBeUndefined();
  });
});

describe("statusFromStripeSubscription (past-due reconcile, stand-in for webhooks)", () => {
  it("maps Stripe's states onto our vocabulary", () => {
    expect(statusFromStripeSubscription({ status: "active", trial_end: null })).toEqual({ subscriptionStatus: "active", trialEndsAt: null });
    expect(statusFromStripeSubscription({ status: "trialing", trial_end: 1_755_000_000 })).toEqual({ subscriptionStatus: "trialing", trialEndsAt: new Date(1_755_000_000 * 1000) });
    expect(statusFromStripeSubscription({ status: "past_due" })?.subscriptionStatus).toBe("past_due");
    expect(statusFromStripeSubscription({ status: "unpaid" })?.subscriptionStatus).toBe("past_due");
    expect(statusFromStripeSubscription({ status: "canceled" })?.subscriptionStatus).toBe("canceled");
    expect(statusFromStripeSubscription({ status: "incomplete_expired" })?.subscriptionStatus).toBe("canceled");
  });
  it("unknown / transitional states → null (nothing is written)", () => {
    for (const s of ["incomplete", "paused", "", "weird"]) expect(statusFromStripeSubscription({ status: s })).toBeNull();
  });
  it("reconcileFields writes only when Stripe's state differs from the stored status", () => {
    expect(reconcileFields({ subscriptionStatus: "past_due" }, { status: "active", trial_end: null })).toEqual({ subscriptionStatus: "active", trialEndsAt: null });
    expect(reconcileFields({ subscriptionStatus: "past_due" }, { status: "canceled" })?.subscriptionStatus).toBe("canceled");
    expect(reconcileFields({ subscriptionStatus: "past_due" }, { status: "past_due" })).toBeNull(); // unchanged
    expect(reconcileFields({ subscriptionStatus: "past_due" }, { status: "incomplete" })).toBeNull(); // unknown
  });
});

// --- grep guards -----------------------------------------------------------

/** Routes that stay on requireUser (or have no auth by design). Must match the
 *  #119 spec EXACTLY — adding a directory here is a deliberate product decision. */
const ALLOWLIST = ["app/api/auth/", "app/api/billing/", "app/api/onboarding/", "app/api/account/", "app/api/admin/"];

/** The exact files inside those directories today. A new route dropped into an
 *  allowlisted directory (e.g. a data route hiding under api/account/) must be
 *  added here deliberately — it cannot inherit the exemption by location. */
const ALLOWLISTED_FILES = [
  "app/api/account/route.ts",
  "app/api/admin/analysis-prompt/route.ts",
  "app/api/admin/billing-health/route.ts",
  "app/api/admin/briefing-prompt/route.ts",
  "app/api/admin/period-coach-prompt/route.ts",
  "app/api/admin/study-prompts/route.ts",
  "app/api/admin/tasks/[id]/route.ts",
  "app/api/admin/tasks/route.ts",
  "app/api/auth/forgot-password/route.ts",
  "app/api/auth/google/callback/route.ts",
  "app/api/auth/google/start/route.ts",
  "app/api/auth/login/route.ts",
  "app/api/auth/logout/route.ts",
  "app/api/auth/reset-password/route.ts",
  "app/api/auth/signup/route.ts",
  "app/api/billing/checkout-session/route.ts",
  "app/api/billing/confirm/route.ts",
  "app/api/billing/portal/route.ts",
  "app/api/onboarding/complete/route.ts",
];

/** Any import list from "@/lib/access" that includes requireActiveUser. */
const ACCESS_IMPORT_RE = /import\s*\{[^}]*\brequireActiveUser\b[^}]*\}\s*from\s*"@\/lib\/access";/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name === "route.ts") out.push(p);
  }
  return out;
}

describe("grep guard: every data API route is gated by requireActiveUser", () => {
  const routes = walk("app/api");
  it("finds the API routes", () => {
    expect(routes.length).toBeGreaterThan(30);
  });
  it("allowlist is exactly the spec's five directories", () => {
    expect([...ALLOWLIST].sort()).toEqual(["app/api/account/", "app/api/admin/", "app/api/auth/", "app/api/billing/", "app/api/onboarding/"]);
  });
  it("the files under those directories are exactly the known allowlisted set (by exact path)", () => {
    const actual = routes.filter((f) => ALLOWLIST.some((d) => f.startsWith(d))).sort();
    expect(actual).toEqual([...ALLOWLISTED_FILES].sort());
  });
  for (const file of routes) {
    const allowlisted = ALLOWLIST.some((d) => file.startsWith(d));
    const src = readFileSync(file, "utf8");
    if (allowlisted) {
      it(`${file} (allowlisted) does NOT gate on requireActiveUser — blocked users must still reach it`, () => {
        expect(src.includes('"@/lib/access"')).toBe(false);
        expect(src.includes("requireActiveUser(")).toBe(false);
      });
      if (file.startsWith("app/api/admin/")) {
        it(`${file} is wrapped in withAdmin(`, () => {
          expect(src.includes("withAdmin(")).toBe(true);
        });
      }
    } else {
      it(`${file} imports requireActiveUser from @/lib/access and never calls requireUser`, () => {
        expect(ACCESS_IMPORT_RE.test(src)).toBe(true);
        expect(src.includes("requireActiveUser()")).toBe(true);
        expect(/\brequireUser\b/.test(src)).toBe(false);
      });
    }
  }
});

describe("grep guard: every (app) page re-runs the gate (client navigations skip the layout)", () => {
  function pages(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) pages(p, out);
      else if (name === "page.tsx") out.push(p);
    }
    return out;
  }
  const all = pages("app/(app)");
  it("finds the pages", () => {
    expect(all.length).toBeGreaterThan(10);
  });
  for (const file of all) {
    it(`${file} calls requirePageAccess(`, () => {
      const src = readFileSync(file, "utf8");
      expect(src.includes("requirePageAccess(")).toBe(true);
      expect(src.includes("getCurrentUser(")).toBe(false); // the gate IS the user lookup
    });
  }
});

describe("grep guard: the (app) layout gates through accessDecision only", () => {
  const src = readFileSync("app/(app)/layout.tsx", "utf8");
  it("calls accessDecision and redirects via DECISION_PATH", () => {
    expect(src.includes("accessDecision(")).toBe(true);
    expect(src.includes("DECISION_PATH[")).toBe(true);
  });
  it("contains no raw subscriptionStatus comparison or needsCheckout/hasAppAccess call", () => {
    expect(/subscriptionStatus\s*[!=]==?/.test(src)).toBe(false);
    expect(src.includes("needsCheckout(")).toBe(false);
    expect(src.includes("hasAppAccess(")).toBe(false);
  });
});

describe("grep guard: the two billing screens self-correct via accessDecision", () => {
  it.each([
    ["app/billing/past-due/page.tsx", '!== "past_due"'],
    ["app/billing/canceled/page.tsx", '!== "canceled"'],
  ])("%s redirects away unless its own decision holds", (file, check) => {
    const src = readFileSync(file, "utf8");
    expect(src.includes("accessDecision(")).toBe(true);
    expect(src.includes(check)).toBe(true);
    expect(/subscriptionStatus\s*[!=]==?/.test(src)).toBe(false);
  });
});

describe("grep guard: no raw subscriptionStatus comparisons anywhere in app/ or components/", () => {
  function walkAll(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walkAll(p, out);
      else if (/\.tsx?$/.test(name)) out.push(p);
    }
    return out;
  }
  it("every status decision goes through lib/subscription", () => {
    const offenders = [...walkAll("app"), ...walkAll("components")].filter((f) => /subscriptionStatus\s*[!=]==?/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
