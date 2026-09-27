# Funnel instrumentation (#111)

**North Star:** trial-to-paid (`checkout_completed` → `trial_converted`).
**Leading indicator:** activation (`canvas_connected` → `first_sync_ok` → `first_plan_rendered`).

Every event is one row in the `FunnelEvent` table (`userId`, `name`, `meta` JSON
string, `createdAt`), written by `lib/funnel.ts`. Two rules:

1. **Logging never throws.** `logEvent` / `logFirst` swallow every error — a
   broken insert costs a data point, never a user request.
2. **Always `await` it in server code.** Vercel freezes the function once the
   response is returned, so a `void logEvent(...)` insert is silently lost.
   Guarded by `tests/funnelAwait.test.ts` and `tests/funnelOnce.test.ts`.

## Events

| Event | Fires in | When | `meta` |
|---|---|---|---|
| `signup_created` | `app/api/auth/signup/route.ts`, `lib/googleAuth.ts` | account created | `{ door: "password" \| "google" }` |
| `welcome_sent` | `lib/welcomeEmail.ts` | welcome email accepted by Resend | — |
| `demo_completed` | `app/api/onboarding/complete/route.ts` | onboarding demo finished | — |
| `canvas_connected` | `app/api/canvas/credentials/route.ts` | Canvas token saved and validated (every valid save, not only the first) | `{ host }` |
| `first_sync_ok` / `first_sync_failed` | `app/api/sync/route.ts` | the user's first **completed** sync, when the account had never fully synced (see "first" rules) | `{ mode, status, failedCourses }` (count) |
| `first_plan_rendered` | `app/(app)/dashboard/page.tsx` | first dashboard render after a completed sync, for users created on/after `FUNNEL_FIRSTS_SINCE` — even an empty plan | `{ items }` (count, may be 0) |
| `checkout_started` | `app/api/billing/checkout-session/route.ts` | Stripe Checkout session created | `{ sessionId }` |
| `checkout_completed` | `app/api/billing/confirm/route.ts` **and** Stripe webhook (`checkout.session.completed`) | card on file, trial started | confirm: `{ sessionId, status, returning }`; webhook: `{ eventId, type, source }` |
| `trial_ending_sent` | `lib/trialEndingEmail.ts` (via webhook `customer.subscription.trial_will_end`) | trial-ending email accepted by Resend | `{ eventId, type, source }` |
| `trial_converted` | Stripe webhook | subscription status `trialing` → `active` | `{ eventId, type, source: "webhook" }` |
| `payment_failed` | Stripe webhook | status moves to `past_due` | same |
| `cancel_scheduled` | Stripe webhook (`customer.subscription.updated`) | `cancel_at_period_end` flips `false` → `true` | same |
| `canceled` | Stripe webhook | status moves to `canceled` (updated or `customer.subscription.deleted`) | same |

Webhook events are decided by `outcomeFromEvent` / `transitionFunnel` in
`lib/stripe.ts` and written in `app/api/billing/webhook/route.ts` (after the
`StripeEvent` idempotency gate, so a redelivered event never double-logs).
Because `checkout_completed` can fire from two places, always count
**distinct users**, never rows.

## The "first" rules (`logFirst`)

`logFirst(name, userId, meta?)` writes `name` only if the user has **no earlier
event in the same family** (one indexed `findFirst`, then the insert):

- `first_sync_ok` + `first_sync_failed` = one family: whichever outcome the first
  completed sync had is normally the only one logged.
- `first_plan_rendered` = its own family.

If the lookup itself fails, nothing is written (better a missing point than a
duplicate). Two truly simultaneous first calls (e.g. two server instances) can
both write — even one `first_sync_ok` **and** one `first_sync_failed` for the
same user. That is harmless: the funnel counts **distinct users**, and the
drop-off query counts both names as one step.

**Who is eligible** — so existing, already-activated users never inflate the
activation steps when they next sync or visit:

- **Sync** (`app/api/sync/route.ts`): only when the Canvas credential exists
  and its `syncedAt` was `null` before this run (never fully synced). A failed
  sync leaves `syncedAt` null, so a retry after a failure is still eligible —
  the family check stops a second event. No credential → never logged, so a
  stray POST can't lock the family.
- **Plan** (`app/(app)/dashboard/page.tsx`): only users with
  `createdAt ≥ FUNNEL_FIRSTS_SINCE` (`"2026-09-27"`, UTC midnight, exported from
  `lib/funnel.ts`) **and** a completed sync (`data.syncedAt` set). The date gate
  is an in-memory check, so older users cost no query at all. A new user costs
  one indexed `findFirst` per dashboard visit until their row exists; it runs
  after `loadCalendarData` (it needs its result) and blocks nothing else.

## How the sync event is recorded

The sync route answers the browser within 50 s (`withDeadline`); the run itself
keeps going under Next's `after()`. For a run **this request owns**:

- answered in time → the event is written (awaited) before the response;
- timed out (`skipped: "timeout"`) → the event is written from `after()` once
  the run settles, so a slow first sync is still recorded.

Both paths share one memoized call, so a run is never logged twice by the same
request. Joined runs (`skipped: "in_flight"`) and no-op answers
(`skipped: "fresh"`) are not logged — the request that owns the run logs it.

## Known limitations

- If the platform kills the instance before a timed-out run settles (past
  `maxDuration` = 60 s), that first sync is not logged; the next completed
  sync is (its `syncedAt` is still null).
- `first_plan_rendered` is only instrumented on the dashboard page (the home
  page after login), not `/plan`, `/courses`, etc.
- Users created before `FUNNEL_FIRSTS_SINCE` never get `first_plan_rendered`,
  and only get `first_sync_*` if they had never fully synced. So in any window
  that includes pre-launch signups, steps 3–4 undercount those users — compare
  windows that start on/after 2026-09-27 for clean activation rates.

## Drop-off query

Distinct users reaching each step in the last 30 days, in funnel order, with the
% drop from the previous step (`pct` is `NULL` when the previous step is 0).
Step 3 counts the first **completed** sync, ok or failed (a failed first sync
still reaches the plan), and the extra `3b` row reports the first-sync ok-rate
(% of step-3 users whose first sync was `first_sync_ok`). Column `pct` is the
% drop from the previous step on rows 1–7 and the ok-rate on row `3b`.
Steps are counted independently (not a strict cohort), so a later step can
exceed an earlier one when users from before the window convert inside it.

```sql
WITH steps(step, label, names) AS (
  VALUES (1, 'signup_created',      ARRAY['signup_created']),
         (2, 'canvas_connected',    ARRAY['canvas_connected']),
         (3, 'first_sync',          ARRAY['first_sync_ok', 'first_sync_failed']),
         (4, 'first_plan_rendered', ARRAY['first_plan_rendered']),
         (5, 'checkout_started',    ARRAY['checkout_started']),
         (6, 'checkout_completed',  ARRAY['checkout_completed']),
         (7, 'trial_converted',     ARRAY['trial_converted'])
),
recent AS (
  SELECT "userId", name FROM "FunnelEvent"
  WHERE "userId" IS NOT NULL AND "createdAt" >= NOW() - INTERVAL '30 days'
),
counts AS (
  SELECT s.step, s.label, COUNT(DISTINCT r."userId")::int AS users
  FROM steps s
  LEFT JOIN recent r ON r.name = ANY (s.names)
  GROUP BY s.step, s.label
),
funnel AS (
  SELECT step::text AS step, label, users,
         ROUND(100.0 * (LAG(users) OVER w - users)
               / NULLIF(LAG(users) OVER w, 0), 1)::float AS pct
  FROM counts
  WINDOW w AS (ORDER BY step)
),
ok_rate AS (
  SELECT '3b' AS step, 'first_sync_ok_rate' AS label,
         COUNT(DISTINCT "userId") FILTER (WHERE name = 'first_sync_ok')::int AS users,
         ROUND(100.0 * COUNT(DISTINCT "userId") FILTER (WHERE name = 'first_sync_ok')
               / NULLIF(COUNT(DISTINCT "userId"), 0), 1)::float AS pct
  FROM recent
  WHERE name IN ('first_sync_ok', 'first_sync_failed')
)
SELECT step, label, users, pct FROM funnel
UNION ALL
SELECT step, label, users, pct FROM ok_rate
ORDER BY step;
```

Verified read-only against the database in the local `.env` on 2026-09-26 (it
runs; that data has 1 signup → 1 Canvas connect → 0 first syncs, since the
`first_*` events had not shipped yet).
