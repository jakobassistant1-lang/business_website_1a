// Billing dress rehearsal (#127): drive the REAL webhook path end to end with
// Stripe test clocks, against a preview deployment + the Neon DEV branch.
//
//   NODE_ENV=development npx tsx --env-file=<file> scripts/billing-rehearsal.ts \
//     --app-url https://<preview>.vercel.app [--scenario 1|2|3|all] [--keep]
//
// Env (values are never printed): DATABASE_URL (dev branch — host must contain
// "little-waterfall"), STRIPE_SECRET_KEY (sk_test_ only), STRIPE_PRICE_ID (test
// price). Optional: VERCEL_AUTOMATION_BYPASS_SECRET (sent as the
// x-vercel-protection-bypass header when the preview has Deployment Protection).
//
// What it does, per scenario: a fresh dev-DB student + a Session row, a Stripe
// test clock, a customer on that clock, a 7-day-trial subscription created via
// the API with Stripe's test cards (Checkout itself can't ride a test clock).
// Stripe's webhooks then hit the preview app, which writes OUR database; this
// script only polls the DB and probes pages with the session cookie, so what it
// proves is the deployed webhook route + access gate, not a simulation of them.
//
//   1  happy path: trialing → trial_will_end (3 days out) → day-7 charge →
//      active → cancel at period end → deleted → canceled
//   2  cancel on day 6: no invoice ever collects money; canceled at trial end
//      (re-checked after the invoice-finalization window, trial_end + 2h)
//   3  declined day-7 card: past_due (+ 307 /billing/past-due, API 401) → fixed
//      card + invoice paid → active
//
// Docs: docs/billing-rehearsal.md. Exit code 1 on any FAIL. Cleanup deletes the
// test clock (and with it the customer + subscription) and the dev-DB user
// unless --keep is passed.
import Stripe from "stripe";
import { randomBytes } from "crypto";
import { prisma } from "../lib/prisma";
import { hashPassword } from "../lib/password";

// ---- tunables ---------------------------------------------------------------
const DB_POLL_TIMEOUT_MS = 90_000; // per expected DB state (webhook delivery + processing)
const DB_POLL_INTERVAL_MS = 2_000;
const CLOCK_ADVANCE_TIMEOUT_MS = 180_000; // Stripe advances asynchronously; big jumps take longer
const CLOCK_POLL_INTERVAL_MS = 2_000;
const FUNNEL_TIMEOUT_MS = 45_000; // funnel rows are fire-and-forget: WARN, never FAIL
const PROBE_TIMEOUT_MS = 20_000;
const WEBHOOK_SETTLE_MS = 8_000; // grace before the idempotency probe reads Stripe's event log
const TRIAL_DAYS = 7; // mirrors lib/subscription TRIAL_DAYS; asserted against Stripe's trial_end below
const DAY = 86_400;
const MINUTE = 60;
const HOUR = 3_600;
/** Stripe creates the day-7 invoice AT trial_end but finalizes and charges it
 *  about an hour later (invoice finalization delay). Any step that needs the
 *  charge to have been ATTEMPTED must advance past that window (rehearsal run 1:
 *  trial_end + 1 minute produced only the $0 trial invoice). */
const CHARGE_SETTLE = 2 * HOUR;

/** Event types our webhook route acts on (lib/stripe outcomeFromEvent). Used
 *  by the idempotency probe to decide which Stripe events SHOULD have a row. */
const HANDLED_EVENT_TYPES = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.trial_will_end",
  "invoice.paid",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
];

// ---- CLI --------------------------------------------------------------------
type Args = { appUrl: string; scenarios: number[]; keep: boolean };

function parseArgs(argv: string[]): Args {
  let appUrl = "";
  let scenario = "all";
  let keep = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--app-url") appUrl = argv[++i] ?? "";
    else if (a.startsWith("--app-url=")) appUrl = a.slice("--app-url=".length);
    else if (a === "--scenario") scenario = argv[++i] ?? "all";
    else if (a.startsWith("--scenario=")) scenario = a.slice("--scenario=".length);
    else if (a === "--keep") keep = true;
    else if (a === "-h" || a === "--help") {
      console.log("usage: scripts/billing-rehearsal.ts --app-url https://<preview> [--scenario 1|2|3|all] [--keep]");
      process.exit(0);
    } else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  const scenarios = scenario === "all" ? [1, 2, 3] : scenario.split(",").map((s) => Number(s.trim()));
  if (scenarios.some((n) => ![1, 2, 3].includes(n))) {
    console.error(`--scenario must be 1, 2, 3 or all (got "${scenario}")`);
    process.exit(2);
  }
  return { appUrl: appUrl.replace(/\/+$/, ""), scenarios, keep };
}

// ---- guards (printed before anything else happens) --------------------------
type Guard = { name: string; ok: boolean; detail: string };

function runGuards(args: Args): Guard[] {
  const guards: Guard[] = [];

  const dbUrl = process.env.DATABASE_URL ?? "";
  let dbHostOk = false;
  try {
    dbHostOk = dbUrl.length > 0 && new URL(dbUrl).hostname.includes("little-waterfall");
  } catch {
    dbHostOk = false;
  }
  guards.push({ name: "DATABASE_URL", ok: dbHostOk, detail: dbHostOk ? 'host contains "little-waterfall" (dev branch)' : dbUrl ? 'host does NOT contain "little-waterfall" — refusing (this is not the dev branch)' : "missing" });

  const sk = process.env.STRIPE_SECRET_KEY ?? "";
  const skOk = sk.startsWith("sk_test_");
  guards.push({ name: "STRIPE_SECRET_KEY", ok: skOk, detail: skOk ? "sk_test_ prefix (test mode)" : sk ? "not an sk_test_ key — refusing" : "missing" });

  const priceOk = (process.env.STRIPE_PRICE_ID ?? "").startsWith("price_");
  guards.push({ name: "STRIPE_PRICE_ID", ok: priceOk, detail: priceOk ? "present" : "missing or not a price_ id" });

  let urlOk = false;
  let urlDetail = "missing (--app-url)";
  if (args.appUrl) {
    try {
      const u = new URL(args.appUrl);
      const host = u.hostname.toLowerCase();
      if (u.protocol !== "https:") urlDetail = "must be https";
      else if (host === "app.navolearning.com") urlDetail = "refusing: that is PRODUCTION";
      else {
        urlOk = true;
        urlDetail = `${host} (preview)`;
      }
    } catch {
      urlDetail = "not a valid URL";
    }
  }
  guards.push({ name: "--app-url", ok: urlOk, detail: urlDetail });

  guards.push({ name: "NODE_ENV", ok: process.env.NODE_ENV !== "production", detail: process.env.NODE_ENV ?? "(unset)" });
  return guards;
}

// ---- result table -----------------------------------------------------------
type Verdict = "PASS" | "FAIL" | "WARN";
type Row = { scenario: string; step: string; expected: string; observed: string; seconds: number; verdict: Verdict };
const rows: Row[] = [];

/** Thrown by a step to abort the rest of its scenario (later steps depend on it). */
class StepFailure extends Error {}

function record(scenario: string, step: string, expected: string, observed: string, seconds: number, verdict: Verdict) {
  rows.push({ scenario, step, expected, observed, seconds: Math.round(seconds * 10) / 10, verdict });
  const tag = verdict === "PASS" ? "  ok  " : verdict === "WARN" ? " warn " : " FAIL ";
  console.log(`[${tag}] ${scenario} · ${step} — expected ${expected}; observed ${observed} (${seconds.toFixed(1)}s)`);
}

function printTable() {
  const headers = ["scenario", "step", "expected", "observed", "s", "verdict"];
  const cells = rows.map((r) => [r.scenario, r.step, r.expected, r.observed, String(r.seconds), r.verdict]);
  const widths = headers.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
  const line = (c: string[]) => "| " + c.map((v, i) => v.padEnd(widths[i])).join(" | ") + " |";
  console.log("");
  console.log(line(headers));
  console.log("|" + widths.map((w) => "-".repeat(w + 2)).join("|") + "|");
  for (const c of cells) console.log(line(c));
}

// ---- generic helpers --------------------------------------------------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nowUnix = () => Math.floor(Date.now() / 1000);
const iso = (unix: number | null | undefined) => (unix ? new Date(unix * 1000).toISOString() : "null");

/** Poll `probe` until it returns a non-null value. Resolves with the value and
 *  seconds waited; rejects (StepFailure) with the LAST observed description. */
async function waitFor<T>(
  probe: () => Promise<{ done: T | null; observed: string }>,
  { timeoutMs, intervalMs }: { timeoutMs: number; intervalMs: number },
): Promise<{ value: T; seconds: number; observed: string }> {
  const start = Date.now();
  let last = "nothing observed";
  for (;;) {
    const { done, observed } = await probe();
    last = observed;
    if (done !== null) return { value: done, seconds: (Date.now() - start) / 1000, observed };
    if (Date.now() - start > timeoutMs) {
      throw new StepFailure(`timed out after ${(timeoutMs / 1000).toFixed(0)}s; last observed: ${last}`);
    }
    await sleep(intervalMs);
  }
}

/** Run one step: record PASS on return, FAIL (and abort the scenario) on throw.
 *  `soft` steps record WARN instead of FAIL and never abort. */
async function step(
  scenario: string,
  name: string,
  expected: string,
  fn: () => Promise<{ observed: string; seconds?: number }>,
  opts: { soft?: boolean } = {},
): Promise<boolean> {
  const start = Date.now();
  try {
    const r = await fn();
    record(scenario, name, expected, r.observed, r.seconds ?? (Date.now() - start) / 1000, "PASS");
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    record(scenario, name, expected, msg, (Date.now() - start) / 1000, opts.soft ? "WARN" : "FAIL");
    if (opts.soft) return false;
    throw new StepFailure(msg);
  }
}

// ---- DB side ----------------------------------------------------------------
const USER_SELECT = {
  id: true,
  subscriptionStatus: true,
  stripeCustomerId: true,
  stripeSubscriptionId: true,
  trialEndsAt: true,
  currentPeriodEnd: true,
  cancelAtPeriodEnd: true,
} as const;
type DbUser = { id: number; subscriptionStatus: string; stripeCustomerId: string | null; stripeSubscriptionId: string | null; trialEndsAt: Date | null; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean };

function describe(u: DbUser): string {
  return `status=${u.subscriptionStatus} sub=${u.stripeSubscriptionId ?? "null"} trialEndsAt=${u.trialEndsAt?.toISOString() ?? "null"} currentPeriodEnd=${u.currentPeriodEnd?.toISOString() ?? "null"} cancelAtPeriodEnd=${u.cancelAtPeriodEnd}`;
}

/** Poll the dev DB until the user row satisfies `pred`. */
async function waitForDb(userId: number, pred: (u: DbUser) => boolean, timeoutMs = DB_POLL_TIMEOUT_MS) {
  return waitFor<DbUser>(
    async () => {
      const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: USER_SELECT });
      return { done: pred(u) ? u : null, observed: describe(u) };
    },
    { timeoutMs, intervalMs: DB_POLL_INTERVAL_MS },
  );
}

/** Poll for a FunnelEvent row by name. Soft by design (fire-and-forget logging). */
async function waitForFunnel(userId: number, name: string, since: Date) {
  return waitFor<{ id: number }>(
    async () => {
      const row = await prisma.funnelEvent.findFirst({ where: { userId, name, createdAt: { gte: since } }, select: { id: true } });
      return { done: row, observed: row ? `FunnelEvent ${name} #${row.id}` : `no FunnelEvent "${name}" yet` };
    },
    { timeoutMs: FUNNEL_TIMEOUT_MS, intervalMs: DB_POLL_INTERVAL_MS },
  );
}

async function createRehearsalUser(scenario: number) {
  const email = `rehearsal+${scenario}-${Date.now()}@navolearning.test`;
  const password = await hashPassword(randomBytes(24).toString("hex"));
  const user = await prisma.user.create({
    data: { email, fullName: "Rehearsal Student", password, tosAcceptedAt: new Date(), onboardedAt: new Date(), subscriptionStatus: "none" },
    select: { id: true, email: true },
  });
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({ data: { token, userId: user.id } });
  return { ...user, token };
}

// ---- HTTP probes against the preview ---------------------------------------
function probeHeaders(token: string): Record<string, string> {
  const h: Record<string, string> = { Cookie: `sp_session=${token}`, "User-Agent": "navo-billing-rehearsal" };
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) h["x-vercel-protection-bypass"] = bypass;
  return h;
}

async function probe(appUrl: string, path: string, token: string): Promise<{ status: number; location: string | null }> {
  const res = await fetch(`${appUrl}${path}`, { headers: probeHeaders(token), redirect: "manual", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  const loc = res.headers.get("location");
  let location: string | null = null;
  if (loc) {
    try {
      location = new URL(loc, appUrl).pathname;
    } catch {
      location = loc;
    }
  }
  return { status: res.status, location };
}

/** Assert GET /dashboard is either allowed (200) or redirected to `redirectTo`. */
async function expectDashboard(appUrl: string, token: string, redirectTo: string | null) {
  const r = await probe(appUrl, "/dashboard", token);
  const observed = `${r.status}${r.location ? ` → ${r.location}` : ""}`;
  if (redirectTo === null) {
    if (r.status !== 200) throw new Error(observed);
  } else if (!(r.status === 307 || r.status === 308 || r.status === 302) || r.location !== redirectTo) {
    throw new Error(observed);
  }
  return { observed };
}

async function expectApiStatus(appUrl: string, token: string, path: string, status: number) {
  const r = await probe(appUrl, path, token);
  if (r.status !== status) throw new Error(`${r.status}`);
  return { observed: `${r.status}` };
}

// ---- Stripe side ------------------------------------------------------------
type Fixture = {
  scenario: number;
  label: string;
  user: { id: number; email: string; token: string };
  clockId: string; // "" until the clock exists (cleanup tolerates it)
  customerId: string;
  subscriptionId: string;
  trialEnd: number; // unix
  startedAt: Date;
  ok: boolean; // false once a hard step failed — the scenario stops there
};

/** Everything created so far, registered the moment it exists so cleanup can
 *  find it even when a scenario aborts halfway (or the script crashes). */
const fixtures: Fixture[] = [];

/** Advance the clock and block until Stripe reports it `ready`. */
async function advanceClock(stripe: Stripe, clockId: string, to: number): Promise<{ observed: string; seconds: number }> {
  const start = Date.now();
  await stripe.testHelpers.testClocks.advance(clockId, { frozen_time: to });
  const r = await waitFor<Stripe.TestHelpers.TestClock>(
    async () => {
      const c = await stripe.testHelpers.testClocks.retrieve(clockId);
      if (c.status === "internal_failure") throw new StepFailure("test clock reported internal_failure");
      return { done: c.status === "ready" && c.frozen_time >= to ? c : null, observed: `clock ${c.status} at ${iso(c.frozen_time)}` };
    },
    { timeoutMs: CLOCK_ADVANCE_TIMEOUT_MS, intervalMs: CLOCK_POLL_INTERVAL_MS },
  );
  return { observed: `clock ready at ${iso(r.value.frozen_time)}`, seconds: (Date.now() - start) / 1000 };
}

/** Attach a Stripe test card and make it the default on both the customer and
 *  the subscription (Stripe charges the subscription's default first). */
async function useCard(stripe: Stripe, customerId: string, subscriptionId: string | null, testPm: string): Promise<string> {
  const pm = await stripe.paymentMethods.attach(testPm, { customer: customerId });
  await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: pm.id } });
  if (subscriptionId) await stripe.subscriptions.update(subscriptionId, { default_payment_method: pm.id });
  return pm.id;
}

function periodEndOf(sub: Stripe.Subscription): number | null {
  // basil moved current_period_end onto the items; read it there (the app's
  // periodFields reads both, so the DB should match whichever is present).
  const legacy = (sub as unknown as { current_period_end?: number | null }).current_period_end;
  return sub.items?.data?.[0]?.current_period_end ?? legacy ?? null;
}

/** Common opening for every scenario: student + session + clock + customer +
 *  trial subscription on pm_card_visa; then wait for the webhook to adopt it. */
async function openScenario(stripe: Stripe, appUrl: string, scenario: number, label: string): Promise<Fixture> {
  const startedAt = new Date();
  const user = await createRehearsalUser(scenario);
  console.log(`\n=== Scenario ${scenario}: ${label} ===`);
  console.log(`dev-DB user #${user.id} ${user.email} (session row created)`);
  const fixture: Fixture = { scenario, label, user, clockId: "", customerId: "", subscriptionId: "", trialEnd: 0, startedAt, ok: true };
  fixtures.push(fixture);

  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: nowUnix(), name: `navo-rehearsal-${scenario}-${Date.now()}` });
  fixture.clockId = clock.id;
  const customer = await stripe.customers.create({ email: user.email, name: "Rehearsal Student", metadata: { userId: String(user.id) }, test_clock: clock.id });
  fixture.customerId = customer.id;
  // Mirror getOrCreateCustomer: the app persists the customer id before checkout.
  await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customer.id } });
  console.log(`test clock ${clock.id} frozen at ${iso(clock.frozen_time)}; customer ${customer.id}`);

  const S = `S${scenario}`;

  try {
    await step(S, "create trial subscription", `Stripe status "trialing", trial_end = +${TRIAL_DAYS}d`, async () => {
      const pmId = await useCard(stripe, customer.id, null, "pm_card_visa");
      const sub = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: process.env.STRIPE_PRICE_ID! }],
        trial_period_days: TRIAL_DAYS,
        default_payment_method: pmId,
        metadata: { userId: String(user.id) },
        // The first invoice is $0 (trial), so nothing needs collecting; if
        // Stripe still could not activate the trial we want a hard error, not
        // an "incomplete" subscription that the webhook would ignore.
        payment_behavior: "error_if_incomplete",
      });
      fixture.subscriptionId = sub.id;
      fixture.trialEnd = sub.trial_end ?? 0;
      const expectedEnd = clock.frozen_time + TRIAL_DAYS * DAY;
      if (sub.status !== "trialing") throw new Error(`Stripe status "${sub.status}"`);
      if (!sub.trial_end || Math.abs(sub.trial_end - expectedEnd) > 5 * MINUTE) throw new Error(`trial_end ${iso(sub.trial_end)} (expected ≈ ${iso(expectedEnd)})`);
      return { observed: `${sub.id} "${sub.status}", trial_end ${iso(sub.trial_end)}` };
    });

    await step(S, "webhook adopts subscription", `DB "trialing" + stripeSubscriptionId set (customer.subscription.created)`, async () => {
      const r = await waitForDb(user.id, (u) => u.subscriptionStatus === "trialing" && u.stripeSubscriptionId === fixture.subscriptionId);
      const trialMatches = r.value.trialEndsAt && Math.abs(r.value.trialEndsAt.getTime() / 1000 - fixture.trialEnd) < MINUTE;
      if (!trialMatches) throw new Error(`${r.observed} — trialEndsAt does not match Stripe's trial_end ${iso(fixture.trialEnd)}`);
      return { observed: r.observed, seconds: r.seconds };
    });

    await step(S, "dashboard while trialing", "200", () => expectDashboard(appUrl, user.token, null));
  } catch (e) {
    if (!(e instanceof StepFailure)) throw e;
    fixture.ok = false;
  }
  return fixture;
}

// ---- scenarios --------------------------------------------------------------
async function scenario1(stripe: Stripe, appUrl: string): Promise<Fixture> {
  const f = await openScenario(stripe, appUrl, 1, "happy path: trial → active → cancel at period end → canceled");
  if (!f.ok) return f;
  const S = "S1";
  const { user } = f;
  try {
    await step(S, "advance to trial_end − 3d + 1m", "clock ready", () => advanceClock(stripe, f.clockId, f.trialEnd - 3 * DAY + MINUTE));

    await step(S, "Stripe emits trial_will_end", "customer.subscription.trial_will_end event for the subscription", async () => {
      const r = await waitFor<Stripe.Event>(
        async () => {
          const evs = await stripe.events.list({ type: "customer.subscription.trial_will_end", limit: 50 });
          const hit = evs.data.find((e) => (e.data.object as { id?: string }).id === f.subscriptionId) ?? null;
          return { done: hit, observed: hit ? hit.id : "no trial_will_end event for this subscription yet" };
        },
        { timeoutMs: 60_000, intervalMs: 3_000 },
      );
      return { observed: r.observed, seconds: r.seconds };
    });

    await step(S, "trial-ending email logged", 'FunnelEvent "trial_ending_sent" (#121)', async () => {
      const r = await waitForFunnel(user.id, "trial_ending_sent", f.startedAt);
      return { observed: r.observed, seconds: r.seconds };
    }, { soft: true });

    await step(S, "DB still trialing after trial_will_end", 'DB "trialing"', async () => {
      const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: USER_SELECT });
      if (u.subscriptionStatus !== "trialing") throw new Error(describe(u));
      return { observed: describe(u) };
    });

    await step(S, "advance to trial_end + 2h (past invoice finalization)", "clock ready", () => advanceClock(stripe, f.clockId, f.trialEnd + CHARGE_SETTLE));

    await step(S, "day-7 charge → active", 'DB "active", currentPeriodEnd ≈ trial_end + 1 month', async () => {
      const r = await waitForDb(user.id, (u) => u.subscriptionStatus === "active" && u.currentPeriodEnd !== null);
      const sub = await stripe.subscriptions.retrieve(f.subscriptionId);
      const stripeEnd = periodEndOf(sub);
      const dbEnd = Math.floor(r.value.currentPeriodEnd!.getTime() / 1000);
      if (stripeEnd === null || Math.abs(dbEnd - stripeEnd) > MINUTE) throw new Error(`${r.observed} — Stripe period end ${iso(stripeEnd)} differs`);
      const monthAhead = dbEnd - f.trialEnd;
      if (monthAhead < 27 * DAY || monthAhead > 32 * DAY) throw new Error(`${r.observed} — period end is ${(monthAhead / DAY).toFixed(1)} days after trial_end, not ≈ 1 month`);
      return { observed: `${r.observed} (Stripe "${sub.status}", period end ${iso(stripeEnd)})`, seconds: r.seconds };
    });

    await step(S, "funnel trial_converted", 'FunnelEvent "trial_converted"', async () => {
      const r = await waitForFunnel(user.id, "trial_converted", f.startedAt);
      return { observed: r.observed, seconds: r.seconds };
    }, { soft: true });

    await step(S, "dashboard while active", "200", () => expectDashboard(appUrl, user.token, null));

    await step(S, "schedule cancel at period end", 'DB cancelAtPeriodEnd true, status still "active"', async () => {
      await stripe.subscriptions.update(f.subscriptionId, { cancel_at_period_end: true });
      const r = await waitForDb(user.id, (u) => u.cancelAtPeriodEnd && u.subscriptionStatus === "active");
      return { observed: r.observed, seconds: r.seconds };
    });

    await step(S, "funnel cancel_scheduled", 'FunnelEvent "cancel_scheduled"', async () => {
      const r = await waitForFunnel(user.id, "cancel_scheduled", f.startedAt);
      return { observed: r.observed, seconds: r.seconds };
    }, { soft: true });

    await step(S, "dashboard while cancel scheduled", "200 (access continues until period end)", () => expectDashboard(appUrl, user.token, null));

    const periodEnd = (await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: USER_SELECT })).currentPeriodEnd!;
    const periodEndUnix = Math.floor(periodEnd.getTime() / 1000);
    await step(S, "advance to currentPeriodEnd + 1m", "clock ready", () => advanceClock(stripe, f.clockId, periodEndUnix + MINUTE));

    await step(S, "subscription deleted → canceled", 'DB "canceled", period cleared (customer.subscription.deleted)', async () => {
      const r = await waitForDb(user.id, (u) => u.subscriptionStatus === "canceled");
      if (r.value.currentPeriodEnd !== null || r.value.cancelAtPeriodEnd) throw new Error(`${r.observed} — period fields not cleared`);
      return { observed: r.observed, seconds: r.seconds };
    });

    await step(S, "funnel canceled", 'FunnelEvent "canceled"', async () => {
      const r = await waitForFunnel(user.id, "canceled", f.startedAt);
      return { observed: r.observed, seconds: r.seconds };
    }, { soft: true });

    await step(S, "dashboard once canceled", "307 → /billing/canceled", () => expectDashboard(appUrl, user.token, "/billing/canceled"));
    await step(S, "API once canceled", "GET /api/dashboard-summary → 401", () => expectApiStatus(appUrl, user.token, "/api/dashboard-summary", 401));
  } catch (e) {
    if (!(e instanceof StepFailure)) throw e;
    f.ok = false;
  }
  return f;
}

async function scenario2(stripe: Stripe, appUrl: string): Promise<Fixture> {
  const f = await openScenario(stripe, appUrl, 2, "cancel on day 6: never charged, canceled at trial end");
  if (!f.ok) return f;
  const S = "S2";
  const { user } = f;
  try {
    await step(S, "advance to trial_end − 1d (day 6)", "clock ready", () => advanceClock(stripe, f.clockId, f.trialEnd - DAY));

    await step(S, "cancel at period end during trial", 'DB cancelAtPeriodEnd true, status still "trialing"', async () => {
      await stripe.subscriptions.update(f.subscriptionId, { cancel_at_period_end: true });
      const r = await waitForDb(user.id, (u) => u.cancelAtPeriodEnd && u.subscriptionStatus === "trialing");
      return { observed: r.observed, seconds: r.seconds };
    });

    await step(S, "dashboard on day 6 with cancel scheduled", "200 (trial continues to its end)", () => expectDashboard(appUrl, user.token, null));

    await step(S, "advance to trial_end + 1m", "clock ready", () => advanceClock(stripe, f.clockId, f.trialEnd + MINUTE));

    await step(S, "trial ends → canceled, no charge", 'DB "canceled" (customer.subscription.deleted at trial end)', async () => {
      const r = await waitForDb(user.id, (u) => u.subscriptionStatus === "canceled");
      return { observed: r.observed, seconds: r.seconds };
    });

    const noMoneyCollected = async () => {
      const invoices = await stripe.invoices.list({ customer: f.customerId, limit: 100 });
      const paid = invoices.data.filter((i) => i.amount_paid > 0);
      const summary = invoices.data.map((i) => `${i.id}:${i.status}:${i.amount_paid}`).join(", ") || "no invoices";
      if (paid.length) throw new Error(`PAID invoices: ${summary}`);
      return { observed: `${invoices.data.length} invoice(s), all amount_paid 0 (${summary})` };
    };
    await step(S, "no money collected", "no invoice with amount_paid > 0", noMoneyCollected);

    await step(S, "Stripe subscription state", 'Stripe status "canceled"', async () => {
      const sub = await stripe.subscriptions.retrieve(f.subscriptionId);
      if (sub.status !== "canceled") throw new Error(`Stripe "${sub.status}"`);
      return { observed: `Stripe "${sub.status}"` };
    });

    await step(S, "dashboard once canceled", "307 → /billing/canceled", () => expectDashboard(appUrl, user.token, "/billing/canceled"));

    // A day-7 charge would be finalized ~1h after trial_end: cross that window
    // too, so a late charge against a canceled trial could not slip past.
    await step(S, "advance to trial_end + 2h (past invoice finalization)", "clock ready", () => advanceClock(stripe, f.clockId, f.trialEnd + CHARGE_SETTLE));
    await step(S, "still no money collected after finalization window", "no invoice with amount_paid > 0", noMoneyCollected);
    await step(S, "DB still canceled after finalization window", 'DB "canceled"', async () => {
      const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: USER_SELECT });
      if (u.subscriptionStatus !== "canceled") throw new Error(describe(u));
      return { observed: describe(u) };
    });
  } catch (e) {
    if (!(e instanceof StepFailure)) throw e;
    f.ok = false;
  }
  return f;
}

async function scenario3(stripe: Stripe, appUrl: string): Promise<Fixture> {
  const f = await openScenario(stripe, appUrl, 3, "declined day-7 card: past_due → card fixed → active");
  if (!f.ok) return f;
  const S = "S3";
  const { user } = f;
  try {
    await step(S, "swap to a card that declines", "pm_card_chargeCustomerFail is the default on customer + subscription", async () => {
      const pmId = await useCard(stripe, f.customerId, f.subscriptionId, "pm_card_chargeCustomerFail");
      return { observed: `default payment method ${pmId}` };
    });

    await step(S, "advance to trial_end + 2h (past invoice finalization)", "clock ready", () => advanceClock(stripe, f.clockId, f.trialEnd + CHARGE_SETTLE));

    await step(S, "day-7 charge fails → past_due", 'DB "past_due" (invoice.payment_failed)', async () => {
      const r = await waitForDb(user.id, (u) => u.subscriptionStatus === "past_due");
      return { observed: r.observed, seconds: r.seconds };
    });

    await step(S, "funnel payment_failed", 'FunnelEvent "payment_failed"', async () => {
      const r = await waitForFunnel(user.id, "payment_failed", f.startedAt);
      return { observed: r.observed, seconds: r.seconds };
    }, { soft: true });

    await step(S, "dashboard while past due", "307 → /billing/past-due", () => expectDashboard(appUrl, user.token, "/billing/past-due"));
    await step(S, "API while past due", "GET /api/dashboard-summary → 401", () => expectApiStatus(appUrl, user.token, "/api/dashboard-summary", 401));

    await step(S, "fix the card and pay the open invoice", "invoice paid with pm_card_visa", async () => {
      const pmId = await useCard(stripe, f.customerId, f.subscriptionId, "pm_card_visa");
      const sub = await stripe.subscriptions.retrieve(f.subscriptionId);
      const latest = typeof sub.latest_invoice === "string" ? sub.latest_invoice : sub.latest_invoice?.id;
      if (!latest) throw new Error("subscription has no latest_invoice");
      const inv = await stripe.invoices.pay(latest, { payment_method: pmId });
      if (inv.status !== "paid") throw new Error(`invoice ${latest} status "${inv.status}"`);
      return { observed: `invoice ${latest} "${inv.status}", amount_paid ${inv.amount_paid}` };
    });

    await step(S, "recovered → active", 'DB "active" (invoice.paid / subscription.updated)', async () => {
      const r = await waitForDb(user.id, (u) => u.subscriptionStatus === "active");
      return { observed: r.observed, seconds: r.seconds };
    });

    await step(S, "dashboard after recovery", "200", () => expectDashboard(appUrl, user.token, null));
    // Soft: this route also calls Gemini, so a non-200 here can be an AI/env
    // hiccup on the preview rather than a gating bug (the gate is proven by
    // the 401 above and the dashboard 200 here).
    await step(S, "API after recovery", "GET /api/dashboard-summary → 200", () => expectApiStatus(appUrl, user.token, "/api/dashboard-summary", 200), { soft: true });
  } catch (e) {
    if (!(e instanceof StepFailure)) throw e;
    f.ok = false;
  }
  return f;
}

// ---- idempotency probe (best effort) ---------------------------------------
async function idempotencyProbe(stripe: Stripe, f: Fixture) {
  const S = `S${f.scenario}`;
  await step(S, "idempotency: Stripe events vs StripeEvent rows", "every handled event delivered once and recorded", async () => {
    await sleep(WEBHOOK_SETTLE_MS);
    // Events for this customer: subscription events carry `customer`; invoice
    // events carry `customer` too. Test-clock events themselves are skipped.
    // Not awaited: the ApiListPromise itself is the async iterator (auto-pagination).
    const list = stripe.events.list({ types: HANDLED_EVENT_TYPES, limit: 100, created: { gte: Math.floor(f.startedAt.getTime() / 1000) - 60 } });
    const mine: Stripe.Event[] = [];
    for await (const ev of list) {
      const o = ev.data.object as { customer?: string | { id: string } | null; id?: string };
      const cust = typeof o.customer === "string" ? o.customer : o.customer?.id;
      if (cust === f.customerId) mine.push(ev);
      if (mine.length >= 200) break;
    }
    const ids = mine.map((e) => e.id);
    const recorded = new Set((await prisma.stripeEvent.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((r) => r.id));
    const missed = mine.filter((e) => !recorded.has(e.id) && e.pending_webhooks === 0);
    const pending = mine.filter((e) => e.pending_webhooks > 0);
    const byType = mine.reduce<Record<string, number>>((acc, e) => ((acc[e.type] = (acc[e.type] ?? 0) + 1), acc), {});
    const typeSummary = Object.entries(byType).map(([t, n]) => `${t}×${n}`).join(", ");
    console.log(`  Stripe events for ${f.customerId}: ${mine.length} (${typeSummary})`);
    for (const e of missed) console.log(`  MISSED: ${e.id} ${e.type} (delivered per Stripe, no StripeEvent row)`);
    for (const e of pending) console.log(`  PENDING: ${e.id} ${e.type} (pending_webhooks=${e.pending_webhooks})`);
    const observed = `${mine.length} events, ${recorded.size} recorded, ${missed.length} missed, ${pending.length} still pending`;
    if (missed.length) throw new Error(observed);
    return { observed };
  }, { soft: true });
}

// ---- cleanup ----------------------------------------------------------------
async function cleanup(stripe: Stripe, keep: boolean) {
  console.log("");
  if (fixtures.length === 0) return;
  if (keep) {
    console.log("--keep: leaving everything in place:");
    for (const f of fixtures) console.log(`  S${f.scenario}: user #${f.user.id} ${f.user.email}, clock ${f.clockId || "(none)"}, customer ${f.customerId || "(none)"}, subscription ${f.subscriptionId || "(none)"}`);
    return;
  }
  console.log("Cleanup:");
  for (const f of fixtures) {
    if (f.clockId) {
      try {
        await stripe.testHelpers.testClocks.del(f.clockId);
        console.log(`  S${f.scenario}: deleted test clock ${f.clockId} (Stripe removes customer ${f.customerId} + its subscription with it)`);
      } catch (e) {
        console.log(`  S${f.scenario}: could not delete test clock ${f.clockId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    try {
      const sessions = await prisma.session.deleteMany({ where: { userId: f.user.id } });
      const funnel = await prisma.funnelEvent.deleteMany({ where: { userId: f.user.id } });
      await prisma.user.delete({ where: { id: f.user.id } });
      console.log(`  S${f.scenario}: deleted dev-DB user #${f.user.id} (${sessions.count} session, ${funnel.count} funnel rows; related rows cascade)`);
    } catch (e) {
      console.log(`  S${f.scenario}: could not delete dev-DB user #${f.user.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log("  StripeEvent rows (event ids) are left in place — tiny, and they are the idempotency ledger.");
}

// ---- main -------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const guards = runGuards(args);
  console.log("Guards:");
  for (const g of guards) console.log(`  [${g.ok ? " ok " : "FAIL"}] ${g.name}: ${g.detail}`);
  if (guards.some((g) => !g.ok)) {
    console.error("Refusing to run: fix the failing guard(s) above.");
    process.exit(2);
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  const price = await stripe.prices.retrieve(process.env.STRIPE_PRICE_ID!);
  if (price.livemode) {
    console.error("Refusing to run: STRIPE_PRICE_ID is a LIVE price.");
    process.exit(2);
  }
  console.log(`Price ${price.id}: ${(price.unit_amount ?? 0) / 100} ${price.currency}/${price.recurring?.interval ?? "?"} (test mode)`);
  console.log(`Preview: ${args.appUrl}; scenarios: ${args.scenarios.join(", ")}; keep=${args.keep}`);

  const runners: Record<number, (s: Stripe, u: string) => Promise<Fixture>> = { 1: scenario1, 2: scenario2, 3: scenario3 };
  let crashed = false;
  try {
    for (const n of args.scenarios) {
      const f = await runners[n](stripe, args.appUrl);
      if (f.customerId) await idempotencyProbe(stripe, f);
    }
  } catch (e) {
    // Not a step failure (those are recorded in the table) — an unexpected
    // Stripe/DB/network error. Still print what we have and clean up.
    crashed = true;
    console.error("\nbilling-rehearsal crashed:", e instanceof Error ? e.stack ?? e.message : String(e));
  } finally {
    printTable();
    const fails = rows.filter((r) => r.verdict === "FAIL").length;
    const warns = rows.filter((r) => r.verdict === "WARN").length;
    const passes = rows.filter((r) => r.verdict === "PASS").length;
    console.log(`\nSummary: ${passes} pass, ${warns} warn, ${fails} fail across ${args.scenarios.length} scenario(s)${crashed ? " — CRASHED before finishing" : ""}.`);
    await cleanup(stripe, args.keep);
    await prisma.$disconnect();
    process.exitCode = fails > 0 || crashed ? 1 : 0;
  }
}

main().catch(async (e) => {
  console.error("billing-rehearsal failed before starting:", e instanceof Error ? e.message : e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
