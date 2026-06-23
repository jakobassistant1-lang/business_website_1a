// Canonical backlog for the value-first ONBOARDING REVAMP — the work that came out
// of the UX discovery + critique + user tests (connect → aha → first win → card,
// web-first). PURE DATA (no Prisma) so it stays unit-testable; the DB top-up lives
// in lib/onboardingSeed.ts.
//
// These ride the existing BUILD board (board = "build") under a dedicated goal
// (GOAL_ONBOARDING) so they show up on the same Kanban + in Hierarchy/Burndown.
// Numbers start at 101 to stay clear of the original MVP tickets (1–24) and of any
// ad-hoc cards the team adds via the API, so the additive top-up never collides.

import { GOAL_ONBOARDING, type BacklogTicket } from "./backlog";

// The "most important" slice — the P0 critical path. Everything is authored as
// "backlog" (new, un-started work). Dependencies reference these 101+ numbers.
export const ONBOARDING_BACKLOG: BacklogTicket[] = [
  // ── O0 — Decide & de-risk ──────────────────────────────────────────────────
  {
    number: 101,
    goal: GOAL_ONBOARDING,
    subgoal: "O0 — Decide & de-risk",
    title: "Lock the onboarding decisions",
    scope:
      "Decide the free-taste boundary (what's free before the card), the price, whether to keep or cut the 'peek', and the analytics tool — and confirm the card is asked AFTER the aha (value-first). Owner call.",
    acceptance: "All five decisions written down · billing + copy unblocked.",
    dependencies: "—",
    size: "small",
    status: "backlog",
  },
  {
    number: 102,
    goal: GOAL_ONBOARDING,
    subgoal: "O0 — Decide & de-risk",
    title: "Test the Canvas connect step with 5–10 real students",
    scope:
      "Watch real students fetch a Canvas access token on the web and paste it back. Note every place they hesitate, get confused, or give up. This is the riskiest step in the whole funnel — de-risk it before building on top of it.",
    acceptance: "Session notes + a ranked list of connect-step friction feeding the connect tickets.",
    dependencies: "—",
    size: "medium",
    status: "backlog",
  },
  {
    number: 103,
    goal: GOAL_ONBOARDING,
    subgoal: "O0 — Decide & de-risk",
    title: "Schema: subscription, trial & onboarding events",
    scope:
      "Add subscription status + trial start/end + Stripe ids, an OnboardingEvent table, and activation fields; redefine onboardedAt as a value event (not 'saw the demo').",
    acceptance: "prisma db push clean · client types regenerate · existing users backfilled safely.",
    dependencies: "—",
    size: "medium",
    status: "backlog",
  },

  // ── O1 — Connect & trust ───────────────────────────────────────────────────
  {
    number: 104,
    goal: GOAL_ONBOARDING,
    subgoal: "O1 — Connect & trust",
    title: "Value-first routing + resumable onboarding state",
    scope:
      "Send new users to Connect (not the full demo); gate the flow by real state (connect → aha → first win → card); closing and reopening resumes the right step; skipping the peek still lands on Connect with a one-line value promise.",
    acceptance: "The step order is enforced · a half-finished user resumes where they left off.",
    dependencies: "103",
    size: "medium",
    status: "backlog",
  },
  {
    number: 105,
    goal: GOAL_ONBOARDING,
    subgoal: "O1 — Connect & trust",
    title: "Harden the Canvas connect step (plain words, trust, errors, sync)",
    scope:
      "Drop the 'API key/access token' jargon; add a safety panel right at the step (read-only, can't change grades, can't post, can't see your password, exactly what we read, encrypted); show specific recoverable messages for every failure (bad/expired key, wrong school, Canvas down); add a 'Pulling your classes…' state so no one stares at a blank spinner.",
    acceptance: "Every connect-failure mode has a clear next step · trust copy present · no bare spinner.",
    dependencies: "102",
    size: "large",
    status: "backlog",
  },

  // ── O2 — Aha & first win ───────────────────────────────────────────────────
  {
    number: 106,
    goal: GOAL_ONBOARDING,
    subgoal: "O2 — Aha & first win",
    title: "Make the first plan land even with thin or messy data",
    scope:
      "Handle near-empty Canvas, all-overdue, all-due-later, and undated items; make the 'aha' copy honest and data-driven (no hardcoded counts); reframe a quiet week as 'you're ahead — here's what's coming.'",
    acceptance: "A brand-new or near-empty account still shows a sensible, honest first screen.",
    dependencies: "103",
    size: "medium",
    status: "backlog",
  },
  {
    number: 107,
    goal: GOAL_ONBOARDING,
    subgoal: "O2 — Aha & first win",
    title: "Guarantee an actionable first win",
    scope:
      "Pick the highest-impact item the student can act on right now (or a study block / setup step as a fallback) — never the dead-overdue item or a two-week monster. Wire 'Start here →' to it and log activation.",
    acceptance: "Every data shape yields a doable first action · the activation event fires.",
    dependencies: "106",
    size: "medium",
    status: "backlog",
  },

  // ── O3 — Trial & billing ───────────────────────────────────────────────────
  {
    number: 108,
    goal: GOAL_ONBOARDING,
    subgoal: "O3 — Trial & billing",
    title: "Trial + billing: take the card AFTER the aha (Stripe)",
    scope:
      "Set up the Stripe product/price; collect the card only after the student has seen their plan + first win, via Stripe Checkout → customer + 7-day trial subscription; enforce the free-taste boundary and gate ongoing access by subscription status.",
    acceptance: "A test-mode 7-day trial subscription is created end-to-end · access is gated by status.",
    dependencies: "101, 103",
    size: "large",
    status: "backlog",
  },
  {
    number: 109,
    goal: GOAL_ONBOARDING,
    subgoal: "O3 — Trial & billing",
    title: "Stripe webhooks, easy cancel & honest terms",
    scope:
      "Handle Stripe webhooks (trial ending, payment ok/failed, subscription changed) idempotently → keep our status in sync; one-click cancel via the Stripe Billing Portal; show clear 'free 7 days, then $X, cancel anytime' terms at the card.",
    acceptance: "Status stays correct through trial→paid→cancel · cancel takes ≤2 steps · terms shown at the card.",
    dependencies: "108",
    size: "medium",
    status: "backlog",
  },
  {
    number: 110,
    goal: GOAL_ONBOARDING,
    subgoal: "O3 — Trial & billing",
    title: "Honest '7-day free trial' messaging everywhere",
    scope:
      "Replace 'free plan' wording (in the app and the marketing Pricing page) with 'free for 7 days, then $X' and show the terms before sign-up so no one feels baited.",
    acceptance: "No copy implies free-forever · the marketing pricing matches the trial model.",
    dependencies: "101",
    size: "small",
    status: "backlog",
  },

  // ── O4 — Lifecycle & measure ───────────────────────────────────────────────
  {
    number: 111,
    goal: GOAL_ONBOARDING,
    subgoal: "O4 — Lifecycle & measure",
    title: "Instrument the funnel + dashboards",
    scope:
      "Stand up product analytics + a server event mirror; track signup → connect → aha → activation → trial → convert; build funnel/cohort dashboards and alerts on connect-drop and cancel-rate.",
    acceptance: "The whole funnel is visible · North Star = trial-to-paid, leading indicator = activation.",
    dependencies: "103",
    size: "medium",
    status: "backlog",
  },
  {
    number: 112,
    goal: GOAL_ONBOARDING,
    subgoal: "O4 — Lifecycle & measure",
    title: "Lifecycle emails: welcome + pre-charge reminder",
    scope:
      "Send a day-0 welcome, a mid-trial value recap, and (most important) a reminder 2 days before the card is charged — via Resend + a scheduled job tied to the trial-ending webhook; show an in-app 'X days left' banner.",
    acceptance: "The pre-charge reminder reliably sends · the countdown shows in-app.",
    dependencies: "109",
    size: "medium",
    status: "backlog",
  },
  {
    number: 113,
    goal: GOAL_ONBOARDING,
    subgoal: "O4 — Lifecycle & measure",
    title: "Tone & 'why pay' copy pass",
    scope:
      "Rewrite, in plain grade 5–6 wording, the moments that decide it: the stressed-student aha (relief, not guilt), the thin-data aha, the connect trust panel, the 'why pay vs free Canvas' line at the card, and the pre-charge reminder.",
    acceptance: "All five surfaces reviewed and updated.",
    dependencies: "105, 106, 109",
    size: "medium",
    status: "backlog",
  },

  // ── O5 — Launch ────────────────────────────────────────────────────────────
  {
    number: 114,
    goal: GOAL_ONBOARDING,
    subgoal: "O5 — Launch",
    title: "Tests, campus beta & launch",
    scope:
      "Unit + integration tests (billing status logic, access gating, thin-data planner, first-win pick, Stripe webhooks) and an end-to-end run of the whole flow incl. thin-data and error paths; a small closed campus beta watching the live funnel; a launch checklist, then go live.",
    acceptance: "Verify gate green · top beta drop-offs fixed · shipped for the August start.",
    dependencies: "104, 105, 107, 108, 109, 111, 112",
    size: "large",
    status: "backlog",
  },
];
