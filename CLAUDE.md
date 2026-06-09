# CLAUDE.md — StudyPlan (Canvassolution)

**Start every response by addressing me as "Massah Calvin."** If you didn't, you didn't read this file.

## How to work with me
1. If there's consequential ambiguity in my directions, or you're unsure what I'm asking, **ask clarifying questions** — don't make unreasonable assumptions.
2. **Be concise.** If a few sentences get the point across, don't write paragraphs.
3. **Explain like I'm new to CS.** When you explain anything, write for a non-technical person just starting to learn — plain English, minimal jargon (define it when unavoidable).

## Dev loop (for all code requests)
1. **Plan** the change (internally — don't stop for sign-off).
2. **Write tests** where meaningful (logic/API/auth/scheduler, via `npm test`; for pure-visual/CSS work, verify visually instead).
3. **Write the code** to pass those tests.
4. **Update documentation** (this file, README, DEPLOYMENT, comments).
5. **Check for gaps** — edge cases, regressions; run `npx tsc --noEmit`, `npm test`, `npm run build`.
6. **Commit locally.**
7. **Push to GitHub** (the `business_website_1a` repo — see Stack & commands).
8. **Explain at the end**, in plain English for a CS beginner, what you did and why — don't interrupt the build to do it.

## Key docs
- **PRD:** [./PRD.md](./PRD.md) — original requirements.
- **Stylesheet / design system:** [./docs/styles.css](./docs/styles.css) — full Flowboard token + component reference.
- **Implemented styling:** `app/globals.css` (tokens as CSS vars) + `tailwind.config.ts` (tokens → Tailwind).
- **Deploy runbook:** [./DEPLOYMENT.md](./DEPLOYMENT.md).

> The PRD describes the original single-user **localhost MVP** (React/Vite/Express/SQLite, plaintext). The code has since moved to **Next.js 15 + Prisma + Postgres**, with **bcrypt hashing**, an **admin Kanban board**, and **Vercel deploy** prep. Treat the PRD as intent; the code is current truth.

## Business model (living — update as refined)
- **Product:** StudyPlan — a Canvas-connected daily study planner for college students. Pulls a student's Canvas assignments/announcements and produces a deadline-safe per-day plan; headline promise is completeness ("never omits an assignment that's due").
- **Who pays / customer:** Students and their parents pay directly (B2C). Users are students juggling multiple Canvas courses (PRD persona "Maya"); parents are a likely funding source.
- **Value proposition:** One trustworthy view of "what to do today" out of scattered Canvas coursework — no missed deadlines.
- **Monetization / pricing:** Direct-pay by students/parents (B2C). Pricing structure + amount TBD.
- **Status / stage:** Early. Moving from a single-user localhost MVP to a publicly deployed multi-user app (Next.js on Vercel + Postgres) at **pinnavel.com**; signup is currently invite-only; a small founding team is building it.
- **Brand / domain:** App is named "StudyPlan"; live domain is **pinnavel.com** — public brand name not yet confirmed.

_Known facts filled in; TBDs + the brand question need Massah Calvin's input._

## Stack & commands
- Next.js 15 (App Router) · React 19 · Prisma 6 + PostgreSQL · Tailwind 3.
- `npm run dev` · `npm run build` · `npm run db:push` · `npm test` · `npm run create-user <email> <pw> "<name>" [--admin]`
- Verify with `npx tsc --noEmit`, `npm test`, and `npm run build`. Tests use **Vitest** (`tests/*.test.ts`).
- **Pushing:** this project's repo is **`business_website_1a`** (git remote `deploy` → `git@github.com:jakobassistant1-lang/business_website_1a.git`) — push everything there. Once Vercel is wired to it, a push to `main` deploys to pinnavel.com.

## Architecture
- `app/(app)/` — authed pages: **Calendar (`/calendar`, the home; `/` redirects here)**, **Timeline (`/timeline`)**, `connections`, `settings`, `account`, `admin`. The group `layout.tsx` requires auth; `admin/layout.tsx` gates admins.
- `app/api/` — route handlers (`auth`, `canvas/credentials`, `plan`, `calendar/briefing`, `sync`, `settings`, `account`, `admin/tasks`).
- `lib/` — `auth`, `admin`, `kanban`, `tone`, `password`, `signup`, `settings`, `plan`, `scheduler`, `priority`, `briefing`, `analysis`, `analysisStore`, `sync`, `canvas`, `prisma`, `crypto`, `calendarData`, `calendarDates`, `courseColor`, `itemType`, `calendar/` (provider-neutral), `googleCalendar/`.
- `components/` — `CalendarView`, `TimelineView`, `calendar/parts` (shared: AttentionBanner, RecommendedOrder, PeriodSummary, ItemPill, ItemDetail, toolbar), `KanbanBoard`, `Sidebar`, `ThemeToggle`, forms. (`PlanView` is retired — see follow-ups.)
- **Calendar & Timeline views:** the student's coursework, replacing the old Plan page. `lib/calendarData.ts` (`loadCalendarData`) is the shared loader — it reuses the scheduler, the priority ranking, busy-hours, and stored events to produce one payload. **Calendar** (`/calendar`, home): Day (default) / Week / Month, each with a study-coach summary + Canvas items placed on due dates + Google "busy" blocks + a per-day **Study plan** list. **Timeline** (`/timeline`): a Gantt — courses as rows, **continuous multi-day bars** (lane-packed, absolutely positioned) in recommended order, with due pins + a Past-Due lane. Both carry the folded-in **AttentionBanner** (overdue only — "won't fit" was removed as noise) + **RecommendedOrder** + undated/completed. The sidebar is collapsible (`lib/`-less, localStorage `sp_sidebar_collapsed`). Per-course colors from `lib/courseColor.ts` (the one sanctioned non-token color); item TYPE from `lib/itemType.ts` → assignment / quiz / **exam** (exam|midterm|test) / other (needs `Assignment.submissionType`, synced from Canvas `submission_types`).
- **Scheduler (`lib/scheduler.ts`, weighted allocation):** NOT earliest-deadline-first anymore. Each day's full budget (`capacity = H`; calendar busy-time no longer subtracts) is allocated in two passes: (1) a **deadline floor** (`must-do-today` keeps every item feasible), then (2) the **slack is split by importance weight** = `sqrt(points) × importanceMult(aiImportance)` — so a big essay outpulls a tiny homework that's merely due sooner, while both still finish on time. Deterministic. When required hours exceed the budget, the unmet remainder surfaces as `plan.overloadHours` (no per-item "won't fit" tag). Still deadline-safe + G1 (every in-window item represented).
- **Overload signal:** `plan.overloadHours` → `CalendarData.overloadHours` → the **`LoadHint`** amber chip (warning tone, NOT red) in the toolbar/Timeline header on Week/Month: "~Nh over this week", expandable, dismissible per-session-per-week (`sp_overload_dismissed_<ymd>`). Hidden on Day view + below ~1h.
- **Study sessions:** `itemType` exam/quiz items get `studyLeadDays` (per-assignment `Assignment.studyLeadDays` overrides `User.studyDaysTest`/`studyDaysQuiz` from Settings; edited on the item card via `/api/assignment/study-lead`). The scheduler places their effort as **study blocks** (`DayBlock.study`) only within `[due − leadDays, due]`, with a hard ~20-min floor the day before. **Window fixed at 7 days** (`PLAN_WINDOW_DAYS`). `defaultEffortHours`/`planningWindowDays` columns kept, not user-editable.
- **AI study coach:** `lib/briefing.ts` `generatePeriodBriefing` + `/api/calendar/briefing?view=&start=&days=` writes a learning-science "game plan" for the selected period. Technique advice is **type-aware**: retrieval practice / active recall for `[exam]`/`[quiz]` study, step-breaking/focus-blocks for `[assignment]`/`[other]` (labs, essays) — never active recall for a lab. Advisory only — it narrates the already-ranked, deadline-safe schedule; **never reorders or invents deadlines**. Fails open; admin-editable at `/admin/ai` (`PERIOD_COACH_PROMPT_KEY`). The UI strip is collapsible (default collapsed) so the grid sits high on the page.
- **AI briefing (legacy):** `lib/priority.ts` ranks assignments deterministically; `lib/briefing.ts` + `/api/briefing` narrate the top picks via Gemini Flash-Lite. Fails open. The briefing prompt is still admin-editable at `/admin/ai` (`BRIEFING_PROMPT_KEY`). Used by the retired Plan view; the **deterministic ranking it relies on still powers RecommendedOrder** in the new views.
- **AI assignment analysis:** `lib/analysis.ts` + `lib/analysisStore.ts` + `/api/analyze` (lazy, batched, cached on the Assignment row via a content hash) have Gemini estimate each assignment's **effort** (hours + quick/medium/long → feeds the scheduler), a **1-5 importance** (`aiImportance` → weights the scheduler's time allocation), and a **one-line summary** (shown in item details / `/api/assignment/describe`). Fails open; its prompt is an editor on `/admin/ai`. (`ANALYSIS_VERSION` in the content hash is bumped when the output shape changes, forcing a one-time re-analysis.)
- **Calendar layer (provider-neutral):** `lib/calendar/` is the abstraction the app talks to — `types.ts` (the `CalendarProvider` interface, `BusyEvent`, and the typed `CalendarError`/`CalendarErrorCode`), `busy.ts` (pure `busyHoursByDate` math), `index.ts` (`loadBusyHoursByDate` — merges busy-time across all configured providers, **fail-open**). Adding a 2nd provider = one new object in `PROVIDERS`. Must not import Canvas.
- **Google Calendar (isolated):** `lib/googleCalendar/` (`auth`/`client`/`calendar`/`http`/`provider`/`types`) + `/api/connections/google/*` (connect/callback/sync/disconnect) + `GoogleCalendarCard` on the Connections tab. Custom OAuth (read-only scope), session-bound CSRF state, tokens encrypted via `lib/crypto.ts`. `provider.ts` implements the neutral `CalendarProvider`. Its own `GoogleCalendarConnection`/`GoogleCalendarEvent` tables — **zero coupling to Canvas**. Needs `GOOGLE_CLIENT_ID`/`SECRET`/`REDIRECT_URI` (+ `ENCRYPTION_KEY`); inert until set.
- **Calendar → planner:** `lib/plan.ts` calls `loadBusyHoursByDate(userId)` and passes the map to `generatePlan`; each day's `capacity` is reduced by busy hours (all-day events ignored), so the plan schedules around real commitments. Fail-open: a calendar problem never breaks the plan.
- **Secrets at rest:** both the Canvas token and Google OAuth tokens are encrypted via `lib/crypto.ts` (AES-256-GCM when `ENCRYPTION_KEY` is set; tagged-plaintext **safe fallback** otherwise). Reads go through `decryptSecret`, which passes legacy unprefixed values through unchanged (backward compatible).

## Auth & admin
- Cookie sessions (`lib/auth.ts`; `getCurrentUser` is request-cached). Passwords are bcrypt-hashed.
- Admin = `User.isAdmin` **or** email in `ADMIN_EMAILS`. `/admin` and `/api/admin/*` are gated server-side (route-group layout + `withAdmin()`); non-admins get 404.
- Signup is **invite-only** via `SIGNUP_INVITE_CODE` (fully closed when unset). Seed accounts with `npm run create-user`.

## Theming (important)
- One token system: CSS vars in `app/globals.css` → Tailwind colors as `rgb(var(--x) / <alpha-value>)`. **Never hardcode colors — use tokens** (`bg-surface`, `text-ink`, `bg-accent`, `text-danger`, `border-line`, …). Light/dark via `[data-theme]`; the Tailwind `dark:` variant is wired to it. Shared status-color classes live in `lib/tone.ts`.

## Database
- Prisma + Postgres. Change `prisma/schema.prisma` then `npm run db:push` (no migrations dir). Per-user uniqueness uses `@@unique([userId, canvasId])` → Prisma key `userId_canvasId`.

## Known follow-ups
- **Calendar — full provider generality.** A neutral `CalendarProvider` seam exists (`lib/calendar`) and busy-time reads flow through it, but OAuth connect/callback/sync/disconnect + the DB tables are still Google-specific. A 2nd provider or a write scope (`calendar.events`) would want a row-discriminated `Connection` model + shared routes. (Light abstraction done; full generalization deferred until a real 2nd provider.)
- **`lib/crypto.ts` is intentionally safe-fallback, not fail-closed.** In production with no `ENCRYPTION_KEY` it warns and stores tagged plaintext (so a missing key never breaks credential-saving). Once `ENCRYPTION_KEY` is set in prod, consider flipping to fail-closed (refuse to store unencrypted).
- **Busy-time + Calendar "today" use server-local day boundaries** (same as the rest of the scheduler), not the user's timezone. Fine while the server is UTC and good enough today; revisit if per-user timezones are added. (`CalendarView` gets `todayYmd` from the server to avoid a hydration mismatch.)
- **Retired Plan view is dead but kept:** `components/PlanView.tsx`, the old `/api/plan` + `/api/briefing` routes, and `lib/plan.ts`'s `loadPlan` are no longer reached (`/` redirects to `/calendar`). Safe to delete in a cleanup pass; left in place to keep this change focused. `lib/briefing.ts` itself is still used (period coach).
- **Calendar/Timeline mobile + polish:** Week/Month collapse to a horizontally-scrollable grid rather than a vertical day-stack on phones; Timeline has no true mobile "sequence list" yet. Also deferred from the UX spec: Calendar Day hour-grid, busy-block detail popovers, full ARIA grid roving-tabindex, an optional plain List/Agenda view.
