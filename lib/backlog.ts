// Canonical Navo MVP backlog — the 24 build tickets, structured
// goal → subgoal → ticket. Seeded into the AdminTask board (prisma/seed-backlog.ts);
// after seeding the DB is the source of truth (tickets get added/moved over time).
//
// Architecture note: the original backlog assumed Vite + React + Express + SQLite +
// single-user/no-auth. We actually shipped Next.js 15 + Prisma + Neon Postgres on
// Vercel with multi-user auth, so the scope/AC below are edited to reflect what was
// really built. Status reflects reality as of the seed (June 2026).

export type BacklogStatus = "backlog" | "todo" | "doing" | "done";
export type BacklogSize = "small" | "medium" | "large";

export interface BacklogTicket {
  number: number;
  goal: string;
  subgoal: string;
  title: string;
  scope: string; // → description
  acceptance: string;
  dependencies: string; // "—" or e.g. "7, 8"
  size: BacklogSize;
  status: BacklogStatus;
}

export const GOAL_CLARITY = "AHA #1 — Clarity";
export const GOAL_DAILY = "AHA #2 — Daily Plan";
export const GOAL_TRUST = "AHA #3 — Trust";
export const GOAL_SHIP = "Ship — Get it to the 5";
// The value-first onboarding revamp (added 2026-06). Its backlog lives in
// lib/onboardingBacklog.ts and is topped up onto the build board by lib/onboardingSeed.ts.
export const GOAL_ONBOARDING = "Onboarding — value-first revamp";

// Order goals appear in the hierarchy/burndown.
export const GOAL_ORDER = [GOAL_CLARITY, GOAL_DAILY, GOAL_TRUST, GOAL_SHIP, GOAL_ONBOARDING];

export const BACKLOG: BacklogTicket[] = [
  // ── AHA #1 — Clarity ──────────────────────────────────────────────────────
  {
    number: 1,
    goal: GOAL_CLARITY,
    subgoal: "1A — Foundation",
    title: "Scaffold the repo",
    scope:
      "Next.js 15 (App Router) full-stack app — React 19 UI + API routes in one project, run with `npm run dev`. (The backlog assumed Vite + React + a separate Express backend; we unified on Next.js instead.)",
    acceptance:
      "Front + back run from one `npm run dev` · the app renders a shell · routing is in place. (No standalone `/api/health` — liveness is the deployed app + `/api/sync`.)",
    dependencies: "—",
    size: "medium",
    status: "done",
  },
  {
    number: 2,
    goal: GOAL_CLARITY,
    subgoal: "1A — Foundation",
    title: "Database schema + data layer",
    scope:
      "Prisma schema on Neon Postgres (not raw SQLite). Models: User, Course, Assignment, CanvasCredential, Session, Setting, AdminTask. Completion lives on the Assignment row (submittedAt / submissionState), not a separate `completion` table; `syncedAt` on CanvasCredential replaces `sync_meta`.",
    acceptance: "Schema migrates via `prisma db push` · a typed Prisma client covers every table · last-sync stored on CanvasCredential.",
    dependencies: "1",
    size: "medium",
    status: "done",
  },
  {
    number: 3,
    goal: GOAL_CLARITY,
    subgoal: "1A — Foundation",
    title: "Config & secrets",
    scope:
      "Env-based config (DATABASE_URL, GEMINI_API_KEY, Google OAuth, ENCRYPTION_KEY, admin/invite vars) via Vercel env + `.env`. The Canvas base URL + token are stored per-user in the DB (token encrypted), not a single global `.env` token.",
    acceptance: "Missing critical env fails loudly · per-user Canvas host + token persisted (encrypted) · secrets never reach the client.",
    dependencies: "1",
    size: "small",
    status: "done",
  },
  {
    number: 4,
    goal: GOAL_CLARITY,
    subgoal: "1B — Canvas connection",
    title: "Canvas API client",
    scope: "Authenticated Canvas client (`lib/canvas.ts`): Bearer token, Link-header pagination, and graceful 401/403/429/timeout handling mapped to typed errors.",
    acceptance: "Generic paginated GET follows pagination to completion · 401/403/429 handled, no crash · returns typed results.",
    dependencies: "3",
    size: "medium",
    status: "done",
  },
  {
    number: 5,
    goal: GOAL_CLARITY,
    subgoal: "1B — Canvas connection",
    title: "Token paste + validation flow",
    scope:
      "Connections UI to paste a Canvas host + token; validated against `GET /users/self`; persisted per user. Runs under real multi-user auth (login/signup + invite code) — not the single-user, no-auth local instance the backlog assumed.",
    acceptance: "Valid token → shows the connected account · invalid → clear error, no crash · token stored (encrypted) for reuse.",
    dependencies: "4",
    size: "medium",
    status: "done",
  },
  {
    number: 6,
    goal: GOAL_CLARITY,
    subgoal: "1C — Completeness pipeline",
    title: "Fetch active courses",
    scope: "`GET /courses?enrollment_state=active`; upsert id + name + course code per user on sync.",
    acceptance: "Current-term courses only · stored with id / name / code.",
    dependencies: "4",
    size: "small",
    status: "done",
  },
  {
    number: 7,
    goal: GOAL_CLARITY,
    subgoal: "1C — Completeness pipeline",
    title: "Fetch all due items",
    scope:
      "Pull every due item across active courses. We fetch per-course assignments (`GET /courses/:id/assignments?include[]=submission`) rather than the Canvas Planner API — that returns assignments + quizzes (via submission_types) AND each item's submission state in one pass, which completion needs.",
    acceptance: "Every in-window item across active courses pulled · paginated fully · captures due_at, type, course, points, html_url, submission state.",
    dependencies: "4, 6",
    size: "medium",
    status: "done",
  },
  {
    number: 8,
    goal: GOAL_CLARITY,
    subgoal: "1C — Completeness pipeline",
    title: "Completeness cross-check + gap flagging",
    scope:
      "Confirm nothing slips — that New Quizzes (LTI), discussion-based, and externally-tooled items are all captured. Foundation: the per-course assignments endpoint already surfaces quizzes via submission_types. Still to do: an explicit reconciliation / debug view + a documented New-Quizzes / LTI coverage finding. (The one ticket that protects the whole value prop.)",
    acceptance: "Per-course count reconciliation · items in one source but not another surfaced in a debug view · documented New Quizzes / LTI coverage.",
    dependencies: "7",
    size: "large",
    status: "todo",
  },
  {
    number: 9,
    goal: GOAL_CLARITY,
    subgoal: "1C — Completeness pipeline",
    title: "Normalize + persist the unified model",
    scope: "One canonical Assignment shape (canvasId, courseId, title, due_at, type, url, points, submission state); idempotent upsert keyed on (userId, canvasId).",
    acceptance: "One record per assignment, deduped across sources · idempotent re-sync (no duplicates) · all in-window items present.",
    dependencies: "7, 8",
    size: "medium",
    status: "done",
  },
  {
    number: 10,
    goal: GOAL_CLARITY,
    subgoal: "1D — The unified list",
    title: "Unified list view",
    scope:
      "Everything due in-window, surfaced across three views rather than one flat list: Calendar (day/week/month), Timeline (Gantt), and the Dashboard 'Today' list — each row shows course, title, due, type, and links out to Canvas.",
    acceptance: "All in-window items visible, grouped by day/time · clicking a row opens the Canvas item · loads fast for a typical course load.",
    dependencies: "9",
    size: "medium",
    status: "done",
  },
  {
    number: 11,
    goal: GOAL_CLARITY,
    subgoal: "1D — The unified list",
    title: "Course color-coding + legend",
    scope: "Stable, deterministic per-course color (`lib/courseColor.ts`, 8-hue palette) used across Calendar/Timeline. Colors appear inline beside each course name (no separate legend panel needed).",
    acceptance: "Each course has a consistent, distinguishable color · the color is shown next to the course everywhere it appears.",
    dependencies: "10",
    size: "small",
    status: "done",
  },
  {
    number: 12,
    goal: GOAL_CLARITY,
    subgoal: "1E — Completion",
    title: "Mark-done → dim & clear",
    scope:
      "Completion is Canvas-submission-driven (not a manual toggle): when Canvas reports a submission, the item dims/strikes and drops out of the active list (the Dashboard flashes it done once). Fixes Canvas's false-stress problem.",
    acceptance: "Submitted items recede / move to a done section the moment a sync sees them · state reflects Canvas truth · persists across reloads.",
    dependencies: "10",
    size: "small",
    status: "done",
  },
  {
    number: 13,
    goal: GOAL_CLARITY,
    subgoal: "1F — Completeness assurance",
    title: "Assurance bar + caught-up state",
    scope:
      "A persistent banner — 'Showing all N items through [window] · last synced [time]' — plus a clean caught-up empty state. Foundation: last-synced labels + caught-up empty states already exist; still to do is the explicit 'all N items through [window]' count banner.",
    acceptance: "Count + window + last-sync shown and accurate · empty state reads as reassurance, not error.",
    dependencies: "10, 12",
    size: "small",
    status: "todo",
  },

  // ── AHA #2 — Daily Plan ───────────────────────────────────────────────────
  {
    number: 14,
    goal: GOAL_DAILY,
    subgoal: "2A — Inputs",
    title: "Per-assignment effort estimate",
    scope:
      "A default effort estimate by type + points (we use a Gemini-assisted estimate → estimatedEffortHours / effortBucket). Still to do: a quick user override (S/M/L or minutes) that persists per assignment.",
    acceptance: "Every item gets a default effort · the user can override it in one tap · the override persists.",
    dependencies: "9",
    size: "medium",
    status: "todo",
  },
  {
    number: 15,
    goal: GOAL_DAILY,
    subgoal: "2B — Engine",
    title: "Rule-based prioritization engine",
    scope:
      "A deterministic, unit-tested ranking (`lib/priority.ts`) from due-proximity + weight + effort — a pure function, no LLM. We also layer an importance-weighted scheduler (`lib/scheduler.ts`) on top for day-by-day allocation.",
    acceptance: "Given a set of assignments, returns a stable ranked order · ranking unit-tested against fixtures · identical output on re-run.",
    dependencies: "14",
    size: "large",
    status: "done",
  },
  {
    number: 16,
    goal: GOAL_DAILY,
    subgoal: "2C — Today view",
    title: 'The "Today" view',
    scope: "The Dashboard's prioritized, capped 'Today' list — what to work on now, ordered by the engine and clearly distinct from the full Calendar/Timeline.",
    acceptance: "Shows a focused short list, not the full backlog · ordered by the engine · clearly distinct from the unified views.",
    dependencies: "15",
    size: "medium",
    status: "done",
  },
  {
    number: 17,
    goal: GOAL_DAILY,
    subgoal: "2D — Lightweight planning",
    title: 'Reschedule / "today vs later"',
    scope:
      "Local plan state to push an item to today or defer it to later — never writes back to Canvas. Not built yet; a per-assignment study-lead override exists, but it isn't a today/later move.",
    acceptance: "User can move an item between today/later · the choice persists · Canvas data is untouched.",
    dependencies: "16",
    size: "medium",
    status: "todo",
  },
  {
    number: 18,
    goal: GOAL_DAILY,
    subgoal: "2E — Daily trigger",
    title: 'Daily email digest of "Today"',
    scope:
      "A scheduled morning email of each user's Today list — via a Vercel Cron + an email provider (e.g. Resend), not the node-cron/Express the backlog assumed. The web-appropriate daily trigger; native push is post-MVP. Not built — first release-valve item.",
    acceptance: "One scheduled send per user per morning · email contains the prioritized Today list with links · failures logged, not silent.",
    dependencies: "16",
    size: "medium",
    status: "backlog",
  },

  // ── AHA #3 — Trust ────────────────────────────────────────────────────────
  {
    number: 19,
    goal: GOAL_TRUST,
    subgoal: "3A — Reliable sync",
    title: "Manual refresh + freshness + error handling",
    scope:
      "A refresh control (`POST /api/sync`), a visible 'last synced', and graceful stale/failed handling — cached data is kept on failure and per-course partial failures are surfaced as warnings.",
    acceptance: "Manual refresh re-pulls and updates last-synced · stale data is labeled, never silently wrong · sync errors show a clear retry path.",
    dependencies: "9, 13",
    size: "medium",
    status: "done",
  },
  {
    number: 20,
    goal: GOAL_TRUST,
    subgoal: "3B — Early warning",
    title: "At-risk detection",
    scope:
      "The scheduler flags at-risk work (`plan.atRisk`) — overdue items, and internally ones that can't fit before their deadline — surfaced as a calm Overdue indicator. (The noisier 'won't fit' alert was deliberately quieted.)",
    acceptance: "At-risk rule defined and tested · flagged items get a clear, calm indicator · warning fires with comfortable lead time.",
    dependencies: "14, 15",
    size: "medium",
    status: "done",
  },
  {
    number: 21,
    goal: GOAL_TRUST,
    subgoal: "3C — What's slipping",
    title: '"What\'s slipping" view',
    scope: "Overdue + at-risk work surfaced in-context — the Dashboard's Overdue rail and the Timeline's past-due lane — rather than a separate page.",
    acceptance: "Lists overdue + at-risk items distinctly · reachable in one tap · empty state = reassurance.",
    dependencies: "20",
    size: "small",
    status: "done",
  },
  {
    number: 22,
    goal: GOAL_TRUST,
    subgoal: "3D — Reassurance",
    title: "Tasteful follow-through reassurance",
    scope:
      "A calm 'you're on top of it' signal — the Dashboard's daily-progress ring + a quiet Focus module — framed as peace of mind, with no points, badges, or streaks (honors the no-gamification cut).",
    acceptance: "Reinforces consistency without gimmicks · never guilt-trips on a missed day · visually quiet.",
    dependencies: "12",
    size: "small",
    status: "done",
  },

  // ── Ship ──────────────────────────────────────────────────────────────────
  {
    number: 23,
    goal: GOAL_SHIP,
    subgoal: "Ship — Package & onboard",
    title: "One-command run + setup docs",
    scope: "README + `.env.example` + a one-command `npm run dev`, plus a deployment guide (Vercel + Neon). Hosted multi-user rather than a per-user local clone.",
    acceptance: "A fresh clone runs end-to-end from the README · connecting Canvas takes <5 min · common errors documented.",
    dependencies: "5, 1",
    size: "small",
    status: "done",
  },
  {
    number: 24,
    goal: GOAL_SHIP,
    subgoal: "Ship — Package & onboard",
    title: "Cohort onboarding + feedback capture",
    scope:
      "A short onboarding flow for the first users + one lightweight feedback channel (a single form/doc). Auth + signup exist; the onboarding checklist and feedback capture aren't built yet.",
    acceptance: "Each user can connect and reach their views unaided · one place collects feedback · an 'is anything missing?' check is part of onboarding.",
    dependencies: "23",
    size: "medium",
    status: "backlog",
  },
];
