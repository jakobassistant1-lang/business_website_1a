# Navo

A locally-hosted, single-user web app that connects to one student's Canvas
account, caches their assignments/announcements, and runs a deterministic
rule-based scheduler to produce a daily study plan.

**Headline guarantee (G1):** the plan never omits an assignment that is due in
the planning window. Every in-window due assignment appears as scheduled work,
an `AT_RISK` flag, or both — enforced by construction *and* a runtime assertion
in the scheduler.

## Stack

- **Next.js 15** (App Router, React 19, TypeScript) — UI + API routes in one process
- **SQLite** via **Prisma** — local file DB (`prisma/dev.db`)
- **Tailwind CSS** — minimal/premium design (violet accent, Inter, card layout)

## Quick start

```bash
cd navo
npm install
cp .env.example .env   # sets DATABASE_URL for the local SQLite file
npm run db:push        # create prisma/dev.db from the schema
npm run dev            # http://localhost:3000
```

Production build:

```bash
npm run build && npm start
```

Then open the app, **sign up**, and go to **Connections**. Pick your school
from the searchable dropdown (or choose "enter the link manually" for an
unlisted school), then follow the guided steps to create a Canvas access token
and paste it in.

## How it works

| Screen | What it does | PRD |
|---|---|---|
| **Plan** (`/`) | Default landing. Per-day plan over the window, stat bar, AT_RISK + undated sections, Refresh, hours override. | FR-3, FR-8, FR-9 |
| **Connections** | Pick your school (searchable dropdown) or enter your Canvas domain manually, then a guided token step (deep link + step-by-step instructions); validates immediately and shows distinct status. | FR-4, FR-5 |
| **Settings** | Defaults: hours/day, planning window (days), effort/assignment. | FR-8, §9 |
| **Account** | Edit profile (name, email, phone, password). | FR-1 |

### Sync model (FR-6/FR-7)
Cache-on-demand only: a sync runs automatically once per browser session (≈ on
login) and on the explicit **Refresh** button. There is **no** background sync.
On any validation/network failure the existing cache is **preserved** and still
used for planning, labeled *stale*. A single course failing mid-sync is a
non-blocking partial failure — its cached rows are kept and a warning lists it.

### Scheduler (FR-9) — `lib/scheduler.ts`
Earliest-deadline-first packing of each assignment's flat effort estimate into
each day's hour budget, from the earliest available day up to its due date.
Anything that can't fit before its due date is split (what fits is scheduled,
the remainder is `AT_RISK`). Overdue items are surfaced as `AT_RISK · Past due`;
undated items go in a separate "No due date" bucket. The function asserts
`representedCount === inWindowDueCount` before returning (G1 guard).

## Defaults chosen for the truncated PRD

The source PRD was cut off mid-FR-9, and §6/§8/§9 weren't included. These
defaults were applied (all easy to change):

| Area | Default | Where to change |
|---|---|---|
| Effort per assignment (`E`) | 2.0 h (flat) | Settings → effort/assignment |
| Planning window (`W`) | 7 days, incl. today | Settings → planning window |
| Hours model | one value applied to every day | — |
| Hours range | `0 < hours ≤ 24`, fractional ok | `app/api/plan`, `app/api/settings` |
| Effort estimate | flat per assignment (no per-type) | `lib/plan.ts` / Settings |

### Canvas endpoints used (§6)
- Validate: `GET /api/v1/users/self`
- Courses: `GET /api/v1/courses?enrollment_state=active`
- Assignments: `GET /api/v1/courses/:id/assignments`
- Announcements: `GET /api/v1/courses/:id/discussion_topics?only_announcements=true`

All requested with `per_page=100` and `Link` (`rel="next"`) pagination. Upserts
are keyed on Canvas id (idempotent re-sync).

### Failure matrix (FR-5)
`valid` (200) · `invalid_token` (401) · `bad_domain` (DNS/refused/404) ·
`unreachable` (timeout/network) · `insufficient_scope` (200 on `/users/self`
but 403 on a data call) · `error` (any other non-2xx).

## Testing

```bash
npm test   # Vitest — tests/*.test.ts
```

Covers the scheduler (weighted allocation, deadline-safety regressions, study
floors, overload), priority ranking, calendar data helpers, AI briefing/analysis
parsing, the Google Calendar adapter, and the admin Kanban — all asserting the
G1 invariant where relevant.

`scripts/seed-demo.mjs` seeds a demo Canvas connection + assignments for a
signed-up user (`node scripts/seed-demo.mjs`) to preview a populated plan
without a live Canvas.

## Local data & reset

The SQLite DB lives at `prisma/dev.db`. To wipe all local data:

```bash
rm prisma/dev.db && npm run db:push
```

## Out of scope (MVP)

Per the PRD: passwords and the Canvas token are stored in **plaintext** (local,
single-user, by design — no hashing/encryption). No background sync, no
multi-user, no LLM/ML, no rate-limiting. Deferred items belong in `BACKLOG.md`.
