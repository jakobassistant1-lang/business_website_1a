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
- `lib/` — `auth`, `admin`, `kanban`, `tone`, `password`, `signup`, `plan`, `scheduler`, `priority`, `briefing`, `sync`, `canvas`, `prisma`.
- `components/` — `PlanView`, `KanbanBoard`, `Sidebar`, `ThemeToggle`, forms.
- **AI briefing:** `lib/priority.ts` ranks assignments with deterministic logic (testable); `lib/briefing.ts` + `/api/briefing` narrate the top picks via Gemini Flash-Lite. The AI **fails open** — the plan + recommendations always render without it. Needs `GEMINI_API_KEY` (server-only).

## Auth & admin
- Cookie sessions (`lib/auth.ts`; `getCurrentUser` is request-cached). Passwords are bcrypt-hashed.
- Admin = `User.isAdmin` **or** email in `ADMIN_EMAILS`. `/admin` and `/api/admin/*` are gated server-side (route-group layout + `withAdmin()`); non-admins get 404.
- Signup is **invite-only** via `SIGNUP_INVITE_CODE` (fully closed when unset). Seed accounts with `npm run create-user`.

## Theming (important)
- One token system: CSS vars in `app/globals.css` → Tailwind colors as `rgb(var(--x) / <alpha-value>)`. **Never hardcode colors — use tokens** (`bg-surface`, `text-ink`, `bg-accent`, `text-danger`, `border-line`, …). Light/dark via `[data-theme]`; the Tailwind `dark:` variant is wired to it. Shared status-color classes live in `lib/tone.ts`.

## Database
- Prisma + Postgres. Change `prisma/schema.prisma` then `npm run db:push` (no migrations dir). Per-user uniqueness uses `@@unique([userId, canvasId])` → Prisma key `userId_canvasId`.

## Known follow-ups
- Canvas API token is still stored **plaintext** — encrypt-at-rest before wider exposure.
