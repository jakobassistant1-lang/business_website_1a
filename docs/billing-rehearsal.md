# Billing dress rehearsal (#127)

A scripted, repeatable proof that the deployed billing path does what the code
says it does — with Stripe's own clock, not ours. It exercises the real webhook
route on a preview deployment, the real database writes, and the real access
gate, for the three money-critical lifecycles:

1. **Happy path** — trial → `trial_will_end` → day-7 charge → active → cancel at
   period end → canceled at period end.
2. **Cancel on day 6** — a student who cancels inside the trial is never charged
   and is canceled at the trial's end.
3. **Declined day-7 card** — the charge fails → past_due → the app blocks them →
   the card is fixed and the open invoice paid → active again.

Harness: `scripts/billing-rehearsal.ts`. Run it before every launch-relevant
deploy of the billing code (see "Repeat before launch" at the bottom).

## What it proves (and what it doesn't)

Proves, end to end, against a deployed build:

- Stripe → `POST /api/billing/webhook` → `User` row: `subscriptionStatus`,
  `stripeSubscriptionId`, `trialEndsAt`, `currentPeriodEnd`, `cancelAtPeriodEnd`
  land with the values the event→outcome table (`lib/stripe.ts
  outcomeFromEvent`, `tests/webhook.test.ts`) promises, in the order Stripe
  actually sends events (including the out-of-order cases the route defends
  against by retrieving the subscription).
- The per-request access gate (`lib/access.ts` → `accessDecision`) as a browser
  would see it: `/dashboard` is 200 while trialing/active (also with a cancel
  scheduled), 307 → `/billing/canceled` once canceled, 307 →
  `/billing/past-due` while past due; `/api/dashboard-summary` answers 401 to a
  blocked account.
- Money: scenario 2 asserts via Stripe's invoice list that **no invoice ever
  collected a cent**; scenario 1 asserts the paid period end is ≈ one month after
  the trial end and equals what Stripe holds.
- Idempotency (best effort): for every handled event Stripe emitted for the
  rehearsal customer, a `StripeEvent` row exists; delivered-but-unrecorded
  events are listed as MISSED.
- Funnel milestones (`trial_converted`, `cancel_scheduled`, `canceled`,
  `payment_failed`, and the #121 `trial_ending_sent`) — reported as WARN, not
  FAIL, when absent, because funnel logging is fire-and-forget by design.

Does **not** prove:

- **The Checkout form itself.** Checkout Sessions cannot be attached to a test
  clock, so the harness creates the subscription through the API (same price,
  same `trial_period_days`, same `metadata.userId`) on a test-clock customer
  with Stripe's test cards. The embedded form, `checkout.session.completed`,
  and the confirm route were verified by hand in July and are unchanged since.
- **The production webhook endpoint.** Everything here runs in Stripe TEST mode
  against a preview URL. Production's endpoint (live secret, live
  `STRIPE_WEBHOOK_SECRET`) is proven only by its first real event — watch the
  Stripe dashboard's webhook page after launch.
- Email delivery (the #121 trial-ending email is observed only through its
  funnel row).
- Anything involving real wall-clock time: Stripe's dunning/Smart Retries
  schedule is not advanced through.

## Prerequisites

Set up once per rehearsal; the orchestrator's checklist.

**1. A Vercel PREVIEW deployment** of the branch under test, with these
environment variables (names only — values live in Vercel):

| Variable | Preview value |
| --- | --- |
| `BILLING_ENABLED` | `1` |
| `DATABASE_URL` | the Neon **dev** branch (host contains `little-waterfall`) |
| `STRIPE_SECRET_KEY` | a **test** key (`sk_test_…`) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | the matching `pk_test_…` |
| `STRIPE_PRICE_ID` | the test-mode price (`price_…`) |
| `STRIPE_WEBHOOK_SECRET` | the signing secret of the test-mode endpoint below |
| `APP_URL` | the preview URL |

Optional on the preview: whatever the trial-ending email needs (#121) if you
want `trial_ending_sent` to show up rather than WARN.

**2. A Stripe TEST-mode webhook endpoint** pointed at
`https://<preview>/api/billing/webhook`, subscribed to at least:
`customer.subscription.created`, `customer.subscription.updated`,
`customer.subscription.deleted`, `customer.subscription.trial_will_end`,
`invoice.paid`, `invoice.payment_failed`, `checkout.session.completed`.
Its signing secret is the preview's `STRIPE_WEBHOOK_SECRET`. Remember the
CLAUDE.md rule: `prisma db push` on the dev branch must have run BEFORE the
endpoint is registered (else verified events 503).

If the preview has Vercel **Deployment Protection** on, Stripe's webhooks will
be blocked by it too — either disable protection for that preview or use a
protection-bypass secret in the endpoint URL. The harness's own page probes send
`x-vercel-protection-bypass` when `VERCEL_AUTOMATION_BYPASS_SECRET` is set in
its env file.

**3. Your machine:** repo checked out at the same commit as the preview,
`npm install` done (`stripe`, `prisma`, `tsx` are already dependencies; no
Stripe CLI needed), Node ≥ 20.6 (for `--env-file`). An env file — say
`.env.rehearsal`, never committed — that defines **all three** of:

```
DATABASE_URL=<Neon dev branch — host must contain "little-waterfall">
STRIPE_SECRET_KEY=<sk_test_…>
STRIPE_PRICE_ID=<price_… (test mode)>
```

Define all three even if some match `.env`: `@prisma/client` loads the repo's
`.env` at import time, and a variable missing from your env file silently
falls back to it. The guards will still refuse a wrong database, but be
explicit.

## The command

```
NODE_ENV=development npx tsx --env-file=.env.rehearsal scripts/billing-rehearsal.ts \
  --app-url https://<preview>.vercel.app [--scenario 1|2|3|all] [--keep]
```

- `--scenario` defaults to `all` (runs 1, 2, 3 in order; `--scenario 1,3` works).
- `--keep` skips cleanup and prints the ids so you can inspect the test clock,
  customer and the dev-DB user in the Stripe dashboard / Neon console.
- Exit code `0` = no FAIL rows (WARNs allowed); `1` = at least one FAIL (or a
  crash); `2` = a guard refused to run.

Budget about 5–10 minutes for all three scenarios: each clock advance is
asynchronous on Stripe's side (polled every 2s, up to 180s), and each expected
database state is polled every 2s for up to 90s.

### Guards (checked before anything else, printed first)

| Guard | Rule |
| --- | --- |
| `DATABASE_URL` | hostname must contain `little-waterfall` (the dev branch) |
| `STRIPE_SECRET_KEY` | must start with `sk_test_` |
| `STRIPE_PRICE_ID` | must be a `price_` id; refused later if Stripe reports it as live-mode |
| `--app-url` | required, `https`, and never `app.navolearning.com` |
| `NODE_ENV` | anything but `production` |

Nothing is created until every guard passes. Secrets are never printed; Stripe
test-mode ids (clock, customer, subscription, invoice, event) are printed
freely because they are the useful breadcrumbs.

## How to read the output

Live log lines as steps complete, then a table, a summary line, and the
cleanup report:

```
| scenario | step                         | expected                     | observed                       | s    | verdict |
|----------|------------------------------|------------------------------|--------------------------------|------|---------|
| S1       | create trial subscription    | Stripe status "trialing" …   | sub_… "trialing", trial_end …  | 1.2  | PASS    |
| S1       | webhook adopts subscription  | DB "trialing" + …            | status=trialing sub=sub_… …    | 6.3  | PASS    |
| S1       | trial-ending email logged    | FunnelEvent "trial_ending…"  | timed out after 45s; …         | 45.1 | WARN    |
…
Summary: 31 pass, 2 warn, 0 fail across 3 scenario(s).
```

- **scenario** — `S1`/`S2`/`S3`.
- **step** — what was done; steps run in order and a scenario stops at its
  first FAIL (later steps depend on the earlier state), then the next scenario
  starts fresh. Cleanup always runs.
- **expected / observed** — the observed column always shows the *last* DB row
  (`status=… sub=… trialEndsAt=… currentPeriodEnd=… cancelAtPeriodEnd=…`) or
  HTTP result (`307 → /billing/canceled`), even on a timeout, so a FAIL tells
  you what the app actually did.
- **s** — seconds waited for that step. Webhook steps usually land in 3–15s;
  a step that PASSes only after 60s+ is a delivery-latency smell worth a look
  in the Stripe webhook dashboard.
- **verdict** — `PASS`; `FAIL` (exit 1); `WARN` = a soft check (funnel rows,
  the idempotency probe, the post-recovery AI endpoint) that did not confirm —
  read it, but it does not block.

## What each scenario asserts

Every scenario opens the same way: a fresh dev-DB student
(`rehearsal+<n>-<timestamp>@navolearning.test`, `subscriptionStatus: "none"`,
onboarded, random bcrypt password) with a `Session` row; a Stripe test clock
frozen at now; a customer on that clock (`metadata.userId`, and the customer id
persisted on the user exactly as `getOrCreateCustomer` does); `pm_card_visa`
attached and set as default; a subscription with the test price,
`trial_period_days: 7`, `metadata.userId`, `payment_behavior:
"error_if_incomplete"` (the first invoice is $0, so anything other than an
immediate `trialing` is a hard error). Then:

**Opening (all scenarios)**

| Step | Asserts |
| --- | --- |
| create trial subscription | Stripe says `trialing`; `trial_end` = clock + 7 days |
| webhook adopts subscription | DB `trialing`, `stripeSubscriptionId` = the new sub, `trialEndsAt` = Stripe's `trial_end` (`customer.subscription.created` adopted by a `none` user) |
| dashboard while trialing | `GET /dashboard` → 200 with the session cookie |

**Scenario 1 — happy path**

| Step | Asserts |
| --- | --- |
| advance to trial_end − 3d + 1m | clock reaches `ready` |
| Stripe emits trial_will_end | a `customer.subscription.trial_will_end` event exists for this subscription |
| trial-ending email logged *(soft)* | `FunnelEvent trial_ending_sent` for the user (#121) |
| DB still trialing | no status change from `trial_will_end` |
| advance to trial_end + 2h | clock `ready` — past Stripe's ~1h invoice finalization delay (see note below) |
| day-7 charge → active | DB `active`; `currentPeriodEnd` equals Stripe's period end and is 27–32 days after `trial_end` |
| funnel trial_converted *(soft)* | row present |
| dashboard while active | 200 |
| schedule cancel at period end | after `subscriptions.update({cancel_at_period_end: true})`: DB `cancelAtPeriodEnd` true, status still `active` |
| funnel cancel_scheduled *(soft)* | row present |
| dashboard while cancel scheduled | 200 — access continues to the period end |
| advance to currentPeriodEnd + 1m | clock `ready` |
| subscription deleted → canceled | DB `canceled`, `currentPeriodEnd` null, `cancelAtPeriodEnd` false |
| funnel canceled *(soft)* | row present |
| dashboard once canceled | 307 → `/billing/canceled` |
| API once canceled | `GET /api/dashboard-summary` → 401 |

**Scenario 2 — cancel on day 6**

| Step | Asserts |
| --- | --- |
| advance to trial_end − 1d | clock `ready` |
| cancel at period end during trial | DB `cancelAtPeriodEnd` true, status still `trialing` |
| dashboard on day 6 | 200 |
| advance to trial_end + 1m | clock `ready` |
| trial ends → canceled, no charge | DB `canceled` |
| no money collected | `invoices.list({customer})`: no invoice with `amount_paid > 0` |
| Stripe subscription state | Stripe says `canceled` |
| dashboard once canceled | 307 → `/billing/canceled` |
| advance to trial_end + 2h | clock `ready` — crosses the invoice finalization window |
| still no money collected | same invoice check, repeated — a late charge against the canceled trial would be caught here |
| DB still canceled | status unchanged after the window |

**Scenario 3 — declined day-7 card**

| Step | Asserts |
| --- | --- |
| swap to a card that declines | `pm_card_chargeCustomerFail` is the default on the customer AND the subscription |
| advance to trial_end + 2h | clock `ready` — past the invoice finalization delay |
| day-7 charge fails → past_due | DB `past_due` (`invoice.payment_failed`, status from the retrieved subscription) |
| funnel payment_failed *(soft)* | row present |
| dashboard while past due | 307 → `/billing/past-due` |
| API while past due | `GET /api/dashboard-summary` → 401 |
| fix the card and pay the open invoice | `pm_card_visa` attached as default; `invoices.pay(latest_invoice, {payment_method})` → `paid` |
| recovered → active | DB `active` |
| dashboard after recovery | 200 |
| API after recovery *(soft)* | `GET /api/dashboard-summary` → 200 (soft: the route also calls Gemini) |

**Note on the invoice finalization delay.** Stripe creates the day-7 invoice
at `trial_end` but finalizes and attempts payment roughly **one hour later**.
Rehearsal run 1 advanced the clock to `trial_end + 1 minute` and saw only the
$0 trial `invoice.paid` — no charge, no `invoice.payment_failed` — so scenario
3 failed for timing, not for an app bug (scenario 1 only passed because its
later month-long advance crossed the hour). Every step that needs the charge to
have been *attempted* now advances to `trial_end + 2h`; scenario 2 keeps the
`+1m` advance (the cancel-at-trial-end must happen with no charge at all) and
then also crosses the window and re-checks.

**Idempotency probe (after each scenario, soft)** — waits 8s for stragglers,
lists Stripe's events of the handled types for the rehearsal customer, and
cross-checks their ids against the `StripeEvent` table. Prints per-type counts,
any `MISSED` (Stripe reports delivered, no row) and any `PENDING`
(`pending_webhooks > 0` — note this counter spans every endpoint in the test
account, so a stale endpoint elsewhere shows up here). Duplicate deliveries are
not visible through the API; the `StripeEvent` primary key is what defends
against them (`tests/webhook.test.ts` covers the P2002 → 200 path).

## Cleanup

Unless `--keep` is passed, at the end (also after a FAIL or a crash):

- each test clock is deleted — Stripe removes the clock's customer and
  subscription with it (this fires a final `customer.subscription.deleted`;
  the route answers 200 whether the user still exists or not);
- each rehearsal user's `Session` and `FunnelEvent` rows and the user itself
  are deleted (Prisma cascade covers anything else);
- `StripeEvent` rows are deliberately left in place — they are the
  idempotency ledger and cost nothing.

What was deleted is printed. If cleanup itself fails (network), the printed ids
let you finish by hand: Stripe dashboard → Test clocks; Neon dev branch →
`DELETE FROM "User" WHERE email LIKE 'rehearsal+%@navolearning.test'`.

## Known gaps

- Checkout form / `checkout.session.completed` / `/api/billing/confirm` are not
  driven (test clocks can't host a Checkout Session). Manually verified in July.
- Production is proven only by its first real webhook. After launch, open
  Stripe → Developers → Webhooks → the live endpoint and confirm the first
  `customer.subscription.created` shows a 200 and the student's row flipped.
- The trial-ending *email* is observed only as a funnel row; the harness never
  reads a mailbox.
- Dunning (Smart Retries over days, `unpaid`, portal-driven card updates) is
  not advanced through; scenario 3 recovers via the API, which exercises the
  same `invoice.paid` path the portal's retry uses.
- `pending_webhooks` is account-wide; other test endpoints make the probe WARN.
- Timing: a preview cold start plus Stripe delivery can push a step past the
  90s DB timeout on a bad day. A lone timeout that passes on a re-run of that
  scenario (`--scenario N`) is latency, not a bug; a repeatable one is not.

## Repeat before launch

1. Deploy the launch candidate as a preview (same commit that will go to prod)
   with the preview env above; confirm `GET /api/admin/billing-health` on the
   preview reports test mode and every check green.
2. Point the test-mode webhook endpoint at that preview URL; copy its signing
   secret into the preview's `STRIPE_WEBHOOK_SECRET`; redeploy if you changed
   it.
3. Run `--scenario all`. Expect 0 FAIL. Read every WARN.
4. Paste the table into the launch ticket (#127) with the preview URL and the
   commit hash.
5. Only then: flip `BILLING_ENABLED=1` on production with live keys, register
   the LIVE endpoint (after `prisma db push` on prod — see the "Prod DB
   schema-sync gap" note), and watch the first real event.
6. Re-run the rehearsal whenever `lib/stripe.ts`, `lib/subscription.ts`,
   `lib/access.ts`, the webhook route, or `prisma/schema.prisma` billing
   columns change.
