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
- `app/(app)/` — authed pages: Plan (`/`), `connections`, `settings`, `account`, `admin`. The group `layout.tsx` requires auth; `admin/layout.tsx` gates admins.
- `app/api/` — route handlers (`auth`, `canvas/credentials`, `plan`, `sync`, `settings`, `account`, `admin/tasks`).
- `lib/` — `auth`, `admin`, `kanban`, `tone`, `password`, `signup`, `settings`, `plan`, `scheduler`, `priority`, `briefing`, `analysis`, `analysisStore`, `sync`, `canvas`, `prisma`.
- `components/` — `PlanView`, `KanbanBoard`, `Sidebar`, `ThemeToggle`, forms.
- **AI briefing:** `lib/priority.ts` ranks assignments with deterministic logic (testable); `lib/briefing.ts` + `/api/briefing` narrate the top picks via Gemini Flash-Lite. The AI **fails open** — the plan + recommendations always render without it. Needs `GEMINI_API_KEY` (server-only). The briefing **prompt is admin-editable at `/admin/ai`** (stored in the `Setting` table via `lib/settings.ts`; falls back to `DEFAULT_BRIEFING_INSTRUCTION`).
- **AI assignment analysis:** `lib/analysis.ts` + `lib/analysisStore.ts` + `/api/analyze` (lazy, batched, cached on the Assignment row via a content hash) have Gemini estimate each assignment's **effort** (hours + quick/medium/long → feeds the scheduler per-assignment instead of the flat default) and a **one-line summary** (shown on plan blocks). Fails open; its prompt is the second editor on `/admin/ai`.
- **Google Calendar (isolated):** `lib/googleCalendar/` (`auth`/`client`/`calendar`/`types`) + `/api/connections/google/*` (connect/callback/sync/disconnect) + `GoogleCalendarCard` on the Connections tab. Custom OAuth (read-only scope), tokens encrypted via `lib/crypto.ts`. Its own `GoogleCalendarConnection`/`GoogleCalendarEvent` tables — **zero coupling to Canvas**. Needs `GOOGLE_CLIENT_ID`/`SECRET`/`REDIRECT_URI` (+ `ENCRYPTION_KEY`); inert until set.

## Auth & admin
- Cookie sessions (`lib/auth.ts`; `getCurrentUser` is request-cached). Passwords are bcrypt-hashed.
- Admin = `User.isAdmin` **or** email in `ADMIN_EMAILS`. `/admin` and `/api/admin/*` are gated server-side (route-group layout + `withAdmin()`); non-admins get 404.
- Signup is **invite-only** via `SIGNUP_INVITE_CODE` (fully closed when unset). Seed accounts with `npm run create-user`.

## Theming (important)
- One token system: CSS vars in `app/globals.css` → Tailwind colors as `rgb(var(--x) / <alpha-value>)`. **Never hardcode colors — use tokens** (`bg-surface`, `text-ink`, `bg-accent`, `text-danger`, `border-line`, …). Light/dark via `[data-theme]`; the Tailwind `dark:` variant is wired to it. Shared status-color classes live in `lib/tone.ts`.

## Database
- Prisma + Postgres. Change `prisma/schema.prisma` then `npm run db:push` (no migrations dir). Per-user uniqueness uses `@@unique([userId, canvasId])` → Prisma key `userId_canvasId`.

## Known follow-ups
- Canvas API token is still stored **plaintext** — encrypt-at-rest (reuse `lib/crypto.ts`) before wider exposure. Currently only Google tokens are encrypted, which is an inconsistent half-measure.
- **Google Calendar — wire events into planning.** `GoogleCalendarEvent` rows are synced + stored but nothing reads them yet; the scheduler (`lib/scheduler.ts`, which has a per-day `capacity` seam) should consume them so the plan accounts for busy time. Until then the integration is storage-only.
- **Google Calendar — typed errors.** Failure reasons (`not_connected`/`token_expired`/`rate_limited`) are string-matched across client/route/UI. Promote to a typed error enum so a rename can't silently fall through to a generic message.
- **Google Calendar — provider generality.** Schema/routes/UI are Google-specific. A 2nd provider or a write scope (`calendar.events`) would mean parallel copies; consider a row-discriminated `Connection` model.
- **`lib/crypto.ts` fail-closed.** In production with no `ENCRYPTION_KEY` it warns but still stores plaintext; consider refusing to store secrets instead.
