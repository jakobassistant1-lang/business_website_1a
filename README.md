# Navo

Navo is a study planner that connects to a student's Canvas account. It pulls in
their courses, assignments and announcements, estimates how much work each one
takes, and lays out a deadline-safe plan: what to do today, what's coming this
week, and what to study before a quiz or exam. It also has per-test study tools
(study guide, practice questions), a calendar and timeline view, and a grade
calculator. The app lives at **app.navolearning.com** and every page is behind a
login. The public marketing site is a **separate project** — it is not in this
repo.

## Stack

- **Next.js 15** (App Router) · **React 19** · **TypeScript** · **Tailwind 3**
- **Prisma 6** + **Neon Postgres** (no migrations folder — schema is pushed)
- **vitest** for tests · deployed on **Vercel**
- **Auth:** email + password (bcrypt-hashed) or "Continue with Google". Student
  signup is open; admin signup needs an invite code.
- **Canvas access:** each student pastes their own Canvas access token during
  onboarding. It is encrypted at rest with `ENCRYPTION_KEY` (AES-256-GCM), as
  are the Google Calendar and Notion tokens.
- **Billing:** Stripe Embedded Checkout (card upfront, then a free trial) behind
  the `BILLING_ENABLED` flag. The flag is **off by default**, and while it is off
  the whole billing and paywall layer is inert.
- **AI:** Google Gemini estimates effort/importance and writes the study
  material. Every AI path **fails open** — if Gemini is down the app still works.

## Quick start

```bash
git clone <this repo>
cd navo-deploy
npm install
cp .env.example .env    # then fill in the variables below
npm run db:push         # create/update the tables in DATABASE_URL
npm run create-user you@example.com 'a-strong-password' 'Your Name' --admin
npm run dev             # http://localhost:3000
```

> **Warning — check `DATABASE_URL` before you run anything.** The `.env` in a
> working copy of this tree may point at the **production** database. `db:push`
> and the seed scripts write to whatever that string points at. For any
> experiment, create a **Neon dev branch** and use its connection string instead.

`npm run db:push` is a separate, explicit step: the build (`prisma generate &&
next build`) no longer pushes the schema for you.

### Environment variables

Names only — never commit values. `.env` is gitignored.

| Variable | What it's for |
|---|---|
| `DATABASE_URL` | Postgres connection string (Neon pooled URL). Required. |
| `ENCRYPTION_KEY` | 32+ random chars. Encrypts stored Canvas/Google/Notion tokens and signs OAuth CSRF state. Unset = tokens stored as tagged plaintext (dev only). |
| `GEMINI_API_KEY` | Gemini key for effort/importance analysis and the study coach. Unset = those features quietly skip. |
| `SIGNUP_INVITE_CODE` | Code required for **admin** signup. Student signup is open regardless. |
| `ADMIN_EMAILS` | Comma-separated emails that get admin access to `/admin`. |
| `GOOGLE_AUTH_CLIENT_ID` / `GOOGLE_AUTH_CLIENT_SECRET` / `GOOGLE_AUTH_REDIRECT_URI` | "Continue with Google" sign-in. Its own OAuth client, non-sensitive scopes only. All three or the button is hidden. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | Google **Calendar** read-only OAuth — a different client from the sign-in one. Unset = the Connect card is inert. |
| `RESEND_API_KEY` + `EMAIL_FROM` | Sends the forgot-password email via Resend. Either unset = the reset link is logged to the server console instead. |
| `APP_URL` | Canonical public origin (e.g. `https://app.navolearning.com`). Emailed links are built from this, never from the request `Host`. |
| `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` / `STRIPE_PRICE_ID` / `STRIPE_WEBHOOK_SECRET` + `BILLING_ENABLED` | Stripe checkout, the monthly price, and webhook signature verification. `BILLING_ENABLED=1` turns the paywall on; leave it unset and nothing billing-related renders. |
| `NOTION_CLIENT_ID` / `NOTION_CLIENT_SECRET` / `NOTION_REDIRECT_URI` | Notion OAuth for importing a student's own notes. Unset = that import option is hidden. |

The Stripe and Notion variables are not yet listed in `.env.example`; copy the
names from this table.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on http://localhost:3000 |
| `npm run build` | `prisma generate && next build` (does **not** touch the DB) |
| `npm test` | vitest, one pass over `tests/*.test.ts` |
| `npx tsc --noEmit` | Typecheck only (no npm script for this) |
| `npm run db:push` | Push `prisma/schema.prisma` to `DATABASE_URL` |
| `npm run create-user <email> <pw> "<Name>" [--admin]` | Create an account directly (bcrypt) |
| `npm run reset-password <email> <new-pw>` | Set a password from the CLI |
| `node scripts/seed-demo.mjs <email> [--clear]` | Fill an existing account with fake Canvas coursework |

Before saying a change is done, run `npx tsc --noEmit`, `npm test`, and
`npm run build`.

## Project map

- **`app/(app)/`** — the signed-in pages: `dashboard` (home), `calendar`,
  `timeline`, `plan`, `study` + `study/[canvasId]`, `courses`,
  `class/[courseId]`, `assignment/[id]`, `connections`, `settings`, `account`,
  and the admin board under `admin/`. The group layout requires a login;
  `admin/layout.tsx` additionally requires admin.
- **`app/`** (outside the group) — `login`, `signup`, `forgot-password`,
  `reset-password`, `demo` (the first-run walkthrough), `welcome/card` and
  `billing/*` (the paywall screens, deliberately outside the authed group).
- **`app/api/`** — route handlers: `auth`, `canvas`, `sync`, `analyze`, `study`,
  `calendar`, `billing` (incl. the Stripe `webhook`), `onboarding`, `notes`,
  `connections`, `settings`, `account`, `admin`.
- **`lib/`** — the logic, kept out of components. The **canonical single-source
  modules** (see the contributing rules): `effortFormat` (how hours are written),
  `assignmentStatus` (what counts as done), `calendarDates` (all day math),
  `subscription` (access + billing status vocabulary), `funnel` (event names),
  `syncPolicy` (when a Canvas sync runs), `access` (the per-request gate).
  Also `scheduler`, `priority`, `calendarData`, `canvas`, `sync`, `crypto`,
  `stripe`, `study`, plus `calendar/` and `googleCalendar/`.
- **`components/`** — the React views (`DashboardView`, `CalendarView`,
  `TimelineView`, `StudyView`, `KanbanBoard`, forms, `calendar/` shared parts).
- **`tests/`** — vitest. Besides normal unit tests, some files are **grep guards**
  (`singleSource.test.ts`, `accessGating.test.ts`, `trialMessaging.test.ts`) that
  fail if a duplicate calculation or an ungated route reappears.
- **`prisma/`** — `schema.prisma` and the backlog seed.
- **`scripts/`** — one-off CLI helpers (`create-user`, `reset-password`,
  `seed-demo`, `seed-canvas`, verification scripts). Anything named
  `scripts/_*` is untracked and throwaway — don't depend on it.

## Deploy

Full runbook: **[DEPLOYMENT.md](./DEPLOYMENT.md)**. The short version, run from
this tree:

```bash
npx prisma db push      # ONLY if prisma/schema.prisma changed — see below
npx vercel --prod --yes
git push deploy deploy-integration:main
```

Schema changes do **not** ride along with the build. If you changed
`prisma/schema.prisma`, get the change approved, confirm it is **additive**
(new nullable columns/tables — never a drop or a rename), run `npx prisma db push`
against production **before** the build, and then check for drift afterwards.
A build that ships code expecting a column the prod DB doesn't have will 500.

## Contributing rules

- **Tokens, not hex.** Colors come from the CSS variables in `app/globals.css`
  via Tailwind (`bg-surface`, `text-ink`, `bg-accent`, `border-line`, …). Never
  hardcode a color. (The only sanctioned exception is the per-course palette in
  `lib/courseColor.ts`.)
- **One concept = one calculation.** If a number or rule already has a canonical
  module, extend that module — never fork a second copy of the formula into a
  component or route. The grep guards in `tests/` exist because this kept
  happening.
- **AI paths fail open.** Gemini being slow, down, or returning garbage must
  never break a page. Degrade to the deterministic result and carry on.
