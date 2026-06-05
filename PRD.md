# StudyPlan — Product Requirements Document (MVP)

**Document type:** PRD · **Audience:** implementing engineer (Claude Code, Opus 4.8) · **Status:** MVP scope frozen
**Build target:** locally-hosted, single-user web app (front end + backend + local DB)

> Conventions used in this document:
> - **`ASSUMPTION:`** — a decision made to remove ambiguity; correct it if wrong.
> - **`OPEN`** — a decision flagged for the author to confirm (collected in §9).
> - **`→ BACKLOG`** — explicitly deferred; tracked in the separate `BACKLOG.md` (produced on a later prompt), **not** in this PRD.

---

## 1. Executive Summary

College students miss deadlines because coursework is scattered across Canvas (assignments, due dates, announcements) with no single view that turns "what's due" into "what to do today." StudyPlan is a localhost web app that connects to one student's Canvas account, caches their assignments and announcements, and applies a deterministic rule-based scheduler to produce a daily study/work plan that surfaces every assignment due in the planning window. It runs entirely on the student's machine against a local database, so there is no deployment, no multi-user, and no cloud dependency to manage. This is buildable now because Canvas exposes assignments and announcements through a stable REST API and personal access tokens, and the scheduling problem is tractable with simple ordering rules — no LLM or ML required. The MVP's single quality bar is completeness: **the plan never omits an assignment that is due.**

---

## 2. Goals & Success Metrics

| # | Goal | Checkable success metric |
|---|------|--------------------------|
| G1 | **No missed assignments (headline)** | For any cached assignment whose due date falls in the planning window, the generated plan output contains a representation of it (scheduled work and/or an explicit AT_RISK flag). **Metric:** `count(in-window due assignments in cache) − count(in-window due assignments represented in plan) == 0`, always. |
| G2 | Student can connect a real Canvas account | A student entering a valid Canvas domain + token gets a "connected/validated" state, and a subsequent sync populates the cache with ≥1 course's assignments when ≥1 exists. **Metric:** validation test call returns 200 and `last_validation_status = "valid"`; post-sync `assignments` row count ≥ Canvas-returned count. |
| G3 | Student gets a plan from a single input | After setting one number (hours/day) the student sees a per-day plan covering the window. **Metric:** plan generation requires exactly one student input (hours); plan renders ≤2s on a cache of ≤500 assignments (local). `ASSUMPTION:` 2s/500-item target. |
| G4 | Resilience to Canvas failures without data loss | When validation/sync fails, the app shows the correct error state and the existing cache is preserved (not wiped). **Metric:** after an induced 401/DNS-failure/timeout, cached `assignments` row count is unchanged and the UI shows the matching error from the §FR-7 matrix. |
| G5 | MVP stays in scope | Build contains only the six IN-SCOPE areas; every deferred item appears in `BACKLOG.md`, not in code. **Metric:** no encryption/hashing/rate-limiting/background-sync/LLM code present. |

---

## 3. User Personas & Use Cases

**Primary persona — "Maya," full-time college student.**
Manages 4–6 concurrent courses in Canvas. Comfortable with web apps, not a developer. Runs StudyPlan locally on her own laptop. Wants to know, each day, what to work on so nothing is late. Owns her own Canvas personal access token.

**Out-of-persona (not designed for in MVP):** instructors, advisors, multiple students sharing one install, mobile users. `→ BACKLOG`

**Core journey (the success path):**
1. **Onboard** — create a local account (email, password, name; phone optional; accept TOS gate).
2. **Connect Canvas** — enter institution Canvas domain + personal access token; app validates.
3. **Sync** — assignments + announcements pulled into local cache (on login / on Refresh).
4. **Set hours** — enter hours available per day.
5. **View plan** — see a per-day plan covering the window, with every due assignment present.

**Secondary use cases:** edit profile (Account), change defaults like hours/day and window length (Settings), re-sync after new Canvas activity (Refresh), recover gracefully when Canvas is down (stale cache shown with a warning).

---

## 4. Functional Requirements

Each requirement is a user story with **testable** acceptance criteria (AC). ACs are written so an agent can assert them.

### FR-1 — Sign up / onboarding
**As Maya, I want to create a local account so that my plan and Canvas connection persist on my machine.**

Acceptance criteria:
1. Signup form exposes fields: `email` (required), `password` (required), `full_name` (required), `phone` (optional).
2. A Terms-of-Service checkbox is present and **unchecked by default**. The submit control is disabled (and submission is rejected if forced) while it is unchecked. No TOS body content is required. `ASSUMPTION:` checkbox label reads "I agree to the Terms of Service" with no link target.
3. On valid submit, exactly one `users` row is created with the entered values; `phone` is null when omitted; `tos_accepted_at` is set to submit time.
4. `email` is unique; submitting an existing email returns a field-level error and creates no new row.
5. Minimal field validation only: `email` matches a basic email pattern; `password` is non-empty. `ASSUMPTION:` no password complexity rules in MVP (`→ BACKLOG`).
6. Password is stored in plaintext in the local DB (see §8). No hashing in MVP.

### FR-2 — Login & session persistence
**As Maya, I want to log in and stay logged in so that I don't re-authenticate every visit.**

Acceptance criteria:
1. Valid email + matching plaintext password establishes a session and lands the user on the **Plan** view (default landing).
2. A persisted local session keeps the user logged in across browser reloads until explicit logout. `ASSUMPTION:` server-side session keyed by an HTTP-only cookie; `sessions` row created on login, removed on logout.
3. Wrong password or unknown email returns a generic "invalid credentials" error and establishes no session.
4. Accessing any app route while unauthenticated redirects to login.

### FR-3 — Application shell & sidebar
**As Maya, I want a persistent left sidebar so that I can move between the plan and configuration.**

Acceptance criteria:
1. A left sidebar is visible on every authenticated view with nav items: **Connections**, **Settings**, **Account**.
2. The **main view** (generated daily Plan) is the default landing view after login and is reachable from the shell (`ASSUMPTION:` an implicit "Plan"/Home item or the app logo returns to it).
3. The active nav item is visually indicated; navigating does not log the user out or clear the cache.

### FR-4 — Connect Canvas (capture domain + token)
**As Maya, I want to enter my Canvas domain and access token so that the app can read my coursework.**

Acceptance criteria:
1. The Connections page captures **both**: (a) Canvas base URL/domain (e.g., `babson.instructure.com`) and (b) a Canvas personal access token.
2. On save, the app normalizes the domain (strips scheme/trailing slash; stores host; constructs API base `https://<host>/api/v1`). `ASSUMPTION:` `https` is assumed; bare host is accepted.
3. Credentials persist to `canvas_credentials` (token stored in plaintext, see §8). `ASSUMPTION:` exactly one Canvas account per user in MVP; saving again overwrites the single record.
4. Saving triggers the validation call in FR-5 before reporting success.

### FR-5 — Validate Canvas credentials (test call + failure states)
**As Maya, I want immediate confirmation that my domain/token work so that I'm not surprised later.**

Validation is a single test call: `GET https://<host>/api/v1/users/self` with header `Authorization: Bearer <token>`.

Acceptance criteria:
1. HTTP **200** → status `valid`; `last_validated_at` set; UI shows success with the returned account name.
2. The UI reports each failure state distinctly per the matrix below; on any failure `last_validation_status` is set accordingly and **no** previously cached coursework is deleted.

| Condition | Detection | Stored status | User-visible message |
|-----------|-----------|---------------|----------------------|
| Invalid / expired token | HTTP 401 | `invalid_token` | "Your Canvas token was rejected. Generate a new token in Canvas and re-enter it." |
| Wrong / unknown domain | DNS failure, connection refused, or HTTP 404 on `/users/self` | `bad_domain` | "We couldn't reach a Canvas instance at that domain. Check the domain (e.g., school.instructure.com)." |
| Canvas unreachable / timeout | Network error or request timeout (`ASSUMPTION:` 10s) | `unreachable` | "Canvas isn't responding right now. Try again shortly." |
| Insufficient token scope | 200 on `/users/self` but 403 later on a data call | `insufficient_scope` | "Your token connected but lacks permission to read courses/assignments. Re-issue a token with full read access." (see §9 OPEN) |
| Unexpected error | Any other non-2xx | `error` | "Validation failed (HTTP <code>). Please retry." |

### FR-6 — Sync Canvas data (cache-on-demand)
**As Maya, I want my assignments and announcements pulled locally so that the planner has data to work with.**

Sync model: **cache-on-demand only.** Sync runs (a) automatically on login and (b) on an explicit **Refresh** action. **No background/scheduled sync** (`→ BACKLOG`). The planner always runs against the local cache.

Acceptance criteria:
1. A sync run, in order: validate (FR-5) → fetch active courses → fetch assignments per course → fetch announcements per course → upsert all into cache → update `synced_at`. (Endpoints in §6.)
2. Assignments are stored with at least: Canvas id, course id, name, `due_at` (nullable), `points_possible` (nullable), `html_url`.
3. Announcements are stored with at least: Canvas id, course id, title, message, posted_at, `html_url`.
4. Upsert is idempotent: re-syncing the same Canvas state does not create duplicate rows (keyed on Canvas id).
5. Pagination is followed (Canvas `Link` header, `rel="next"`); `per_page=100` is requested. A multi-page course list/assignment list is fully retrieved.
6. The Plan view shows the timestamp of the last successful sync.

### FR-7 — Sync failure behavior & stale data
**As Maya, I want the app to keep working off cached data when Canvas is down so that I still get a plan.**

Acceptance criteria:
1. If validation fails at the start of a sync (401 / bad domain / unreachable per FR-5), the sync aborts, the matching error is shown, and **the existing cache is preserved and still used for planning**, labeled as stale with the last successful sync time.
2. If a sync partially fails mid-run (e.g., one course's assignment fetch errors), already-fetched data is committed, previously cached data for the failed course is retained, and a non-blocking warning lists which course(s) failed. No cache is wiped on partial failure.
3. On a successful sync, the stale label is cleared.
4. With an empty cache **and** a failed sync, the Plan view shows the empty state plus the sync error (it does not show a fabricated plan).

### FR-8 — Set available hours
**As Maya, I want to enter how many hours I can work so that the plan fits my real capacity.**

Acceptance criteria:
1. The student provides a single numeric input: **hours available per day**. `ASSUMPTION:` (recommendation — see §6/§9) one value applied uniformly to **every day** in the planning window. Per-day-varying hours is `→ BACKLOG`.
2. Accepted range is a positive number; `ASSUMPTION:` `0 < hours ≤ 24`, fractional allowed (e.g., 2.5).
3. The value defaults from Settings (`default_hours_per_day`) and can be overridden for the current plan.
4. Changing hours and regenerating produces a plan reflecting the new budget.

### FR-9 — Generate the daily plan (rule-based)
**As Maya, I want a per-day work plan ordered by urgency so that I finish things before they're due.**

**Inputs:** the cached assignments; `H` = hours/day (FR-8); planning window `W` (`ASSUMPTION:` next **7** days inclusive of today, configurable in Settings — `OPEN`, §9); `E` = estimated effort per assignment (`ASSUMPTION:` flat **2.0 h** default, configurable in Settings — `OPEN`, §9).

**Ordering rule:** **Earliest Due Date first (EDF)**, tie-broken by `points_possible` descending, then by assignment id ascending (deterministic, stable).

**Allocation rule (deterministic, splittable, deadline-bounded, front-loaded):**
```
window_end = today + (window_days - 1)
todo       = assignments with a due date ≤ window_end   # includes overdue
for a in todo: a.remaining = a.estimated_effort or E
sort todo by (due_at asc, points_possible desc, id asc)
capacity[day] = H  for each day in [today .. window_end]

for a in todo:                       # most-urgent first
  for day in [today .. min(a.due_date, window_end)]:   # never past its due date
    if a.remaining == 0: break
    take = min(capacity[day], a.remaining)
    if take > 0:
      add SCHEDULED block(a, day, take)
      capacity[day] -= take
      a.remaining   -= take
  if a.remaining > 0:                # cannot fully fit before deadline
    add AT_RISK item(a, shortfall = a.remaining)   # surfaced, never dropped
```

Acceptance criteria:
1. Scheduled blocks for an assignment never fall on a date later than its due date.
2. The sum of allocated hours on any day does not exceed `H` (the day's budget caps the plan).
3. An assignment may be split across multiple days; the sum of its SCHEDULED + AT_RISK shortfall hours equals its estimated effort.
4. **Overcommitment is surfaced, not dropped:** when total required effort before a deadline exceeds available capacity, the unfittable remainder appears as an explicit **AT_RISK** item with its shortfall; nothing is silently omitted. (See FR-10.)
5. Assignments **without** a due date are not deadline-scheduled; they appear in a separate **"No due date"** list so they are not lost. `ASSUMPTION:` no-due-date items are excluded from G1's window count but still displayed.
6. Overdue-but-still-in-cache assignments (due date < today) are scheduled at the front (today) and flagged **OVERDUE**; if they cannot fit today's remaining capacity they become AT_RISK. `ASSUMPTION:` MVP does **not** read submission/completion status, so submitted work may still appear (completion-aware filtering is `→ BACKLOG`; this is the safe choice for the completeness guarantee — see §9).
7. The algorithm is deterministic: identical inputs produce identical output.

> The scheduler optimizes for **completeness and deadline-safety**, not for an optimal study schedule. Smarter prioritization (effort-weighting, just-in-time scheduling, spaced study) is `→ BACKLOG`.

### FR-10 — No-missed-assignment guarantee (headline AC)
**As Maya, I want certainty that nothing due is missing from my plan so that I can trust it.**

Acceptance criteria:
1. **Completeness invariant:** every assignment in the cache whose `due_at` is within `[today, window_end]` is represented exactly once in the plan output — either as one-or-more SCHEDULED/OVERDUE blocks summing to its full estimated effort, or as an AT_RISK item carrying its shortfall (or a combination summing to its effort).
2. **Checkable test:** `set(in-window due assignment ids in cache) == set(distinct assignment ids appearing in plan output)`. The set difference must be empty in both directions for in-window due assignments.
3. The plan output explicitly separates four buckets so coverage is visually verifiable: **Scheduled (by day)**, **At risk (shortfall)**, **Overdue**, **No due date**.
4. Capacity exhaustion, ties, equal due dates, and overcommitment must **not** cause an in-window due assignment to be absent from the output. This is asserted by an automated test fixture (overcommitted dataset → assert no in-window due id is missing).

### FR-11 — Account page
**As Maya, I want to view and edit my profile so that my account info stays current.**

Acceptance criteria:
1. Account displays the onboarding fields: `email`, `full_name`, `phone`.
2. `full_name` and `phone` are editable and persist on save; `phone` may be cleared. `ASSUMPTION:` `email` is read-only in MVP (it is the account key); editing email is `→ BACKLOG`.
3. Saving updates the existing `users` row only.

### FR-12 — Settings page
**As Maya, I want app defaults so that I don't re-enter the same numbers each time.**

Acceptance criteria:
1. Settings exposes a minimal, defined set: `default_hours_per_day`, `planning_window_days`, `default_effort_hours`.
2. Defaults: `ASSUMPTION:` hours/day = 3, window = 7 days, effort/assignment = 2.0 h.
3. Saved settings persist and are used as the defaults for FR-8/FR-9. No other preferences are added in MVP (keep lean).

---

## 5. Out of Scope

The following are **explicitly excluded** from the MVP build and belong in `BACKLOG.md`, not in this PRD or its code:

- Voice-to-text note taking.
- Any non-Canvas integration (Google Classroom, Blackboard, calendar export, etc.).
- LLM-/ML-based planning or prioritization.
- **Security hardening of any kind** — encryption at rest, password hashing, token encryption, rate limiting, CSRF/secret rotation, input fuzzing, etc.
- Deployment / hosting / cloud services of any kind.
- Multi-user, multi-tenancy, account sharing, roles/permissions.
- Mobile apps or mobile-responsive design.
- Background/scheduled Canvas sync.
- Completion-/submission-aware filtering of assignments.
- Per-day-varying available hours; per-assignment manual effort entry; editable email.

---

## 6. Technical Specifications

### 6.1 Stack (one-line rationale each)
- **Front end:** React + Vite (TypeScript). *Rationale: component model fits the sidebar shell and stateful plan view; Vite gives fast local dev with zero hosting config.*
- **Backend:** Node.js + Express (TypeScript). *Rationale: one language across the stack and a thin REST layer that also proxies Canvas calls (keeps the token server-side).*
- **Local DB:** SQLite via `better-sqlite3` (or Prisma over SQLite). *Rationale: a single local file database with no server process — exactly right for single-user localhost.*

`ASSUMPTION:` stack choice is a recommendation; any equivalent FE/BE/local-DB trio is acceptable so long as the data model, endpoints, and ACs are met. The architecture is a conventional FE + BE + local DB so it can grow later — **no deployment/multi-tenancy concerns are in scope.**

### 6.2 Data model

| Entity | Field | Type | Notes / constraints |
|--------|-------|------|---------------------|
| **users** | id | PK | |
| | email | text | unique, required |
| | password | text | **plaintext (MVP)** |
| | full_name | text | required |
| | phone | text | nullable (optional field) |
| | tos_accepted_at | datetime | set when TOS checkbox accepted |
| | created_at | datetime | |
| **sessions** | id / token | PK | local session id |
| | user_id | FK→users | |
| | created_at / last_seen_at | datetime | removed on logout |
| **canvas_credentials** | id | PK | one per user (MVP) |
| | user_id | FK→users | unique |
| | base_host | text | normalized host, e.g., `school.instructure.com` |
| | access_token | text | **plaintext (MVP)** |
| | last_validated_at | datetime | nullable |
| | last_validation_status | text | enum: valid / invalid_token / bad_domain / unreachable / insufficient_scope / error |
| **courses** *(cache)* | id | PK | Canvas course id |
| | user_id | FK→users | |
| | name | text | |
| | enrollment_state | text | e.g., active |
| | synced_at | datetime | |
| **assignments** *(cache)* | id | PK | Canvas assignment id |
| | user_id | FK→users | |
| | course_id | FK→courses | |
| | name | text | |
| | due_at | datetime | **nullable** |
| | points_possible | number | nullable |
| | html_url | text | link back to Canvas |
| | estimated_effort_hours | number | nullable; falls back to Settings `default_effort_hours` at plan time |
| | synced_at | datetime | |
| **announcements** *(cache)* | id | PK | Canvas id |
| | user_id | FK→users | |
| | course_id | FK→courses | |
| | title | text | |
| | message | text | |
| | posted_at | datetime | |
| | html_url | text | |
| | synced_at | datetime | |
| **plans** *(generated)* | id | PK | |
| | user_id | FK→users | |
| | generated_at | datetime | |
| | window_start / window_end | date | |
| | hours_per_day | number | input used |
| | effort_default | number | input used |
| **plan_items** | id | PK | |
| | plan_id | FK→plans | |
| | assignment_id | FK→assignments | |
| | scheduled_date | date | nullable for AT_RISK/NO_DUE_DATE |
| | allocated_hours | number | for SCHEDULED/OVERDUE; shortfall for AT_RISK |
| | status | text | enum: SCHEDULED / OVERDUE / AT_RISK / NO_DUE_DATE |
| **settings** | user_id | PK/FK→users | |
| | default_hours_per_day | number | default 3 |
| | planning_window_days | int | default 7 |
| | default_effort_hours | number | default 2.0 |

### 6.3 Canvas REST API usage
Base: `https://<base_host>/api/v1`. Auth header on every call: `Authorization: Bearer <access_token>`. Pagination via `Link` header (`rel="next"`); request `per_page=100`.

| Purpose | Method & path |
|---------|---------------|
| Validate token / identify user | `GET /users/self` |
| List active courses | `GET /courses?enrollment_state=active&per_page=100` |
| List a course's assignments | `GET /courses/:course_id/assignments?per_page=100` |
| List a course's announcements | `GET /announcements?context_codes[]=course_:course_id&per_page=100` |

`ASSUMPTION:` these are the standard, long-stable Canvas LMS REST v1 endpoints. **The implementing agent must verify exact params, scopes, and field names against the live Canvas API docs (`https://canvas.instructure.com/doc/api/`)** before finalizing, since the institution may run a slightly different Canvas version. Token scope is `OPEN` (§9).

### 6.4 Credential-validation test call
1. `GET /users/self` with the bearer token.
2. Map the response to a status per the FR-5 matrix (200→valid, 401→invalid_token, DNS/refused/404→bad_domain, timeout/network→unreachable, 403 on a later data call→insufficient_scope, else→error).
3. Persist `last_validation_status` and `last_validated_at`. Never delete cached data on a failed validation.

### 6.5 Sync flow (on login and on Refresh)
1. Run validation (6.4). If not `valid` → abort sync, surface error (FR-7), keep & flag stale cache.
2. `GET /courses?enrollment_state=active` (paginate) → upsert `courses`.
3. For each course: `GET /courses/:id/assignments` (paginate) → upsert `assignments`.
4. For each course (or batched `context_codes[]`): `GET /announcements?context_codes[]=course_:id` (paginate) → upsert `announcements`.
5. Set `synced_at`; clear stale flag on success.
6. On partial failure, commit what succeeded, retain prior data for failed courses, surface a non-blocking warning (FR-7.2). The token is held server-side and is never returned to the front end or placed in any URL/query string.

---

## 7. UX & Design Requirements

Visual style is minimal and functional (no marketing surfaces). Every screen below specifies the five interaction states where applicable: **default · loading · error · empty · success.**

### 7.1 Sidebar shell
- Persistent left sidebar with **Connections**, **Settings**, **Account**, plus a way back to the **Plan** (home).
- *Default:* active item highlighted. *Loading:* content area shows a spinner/skeleton, nav stays interactive. *Error:* content area shows an inline error banner; nav unaffected. *Empty/Success:* per the specific view below.

### 7.2 Onboarding form
- Fields: email, password, full name, phone (clearly marked **optional**).
- TOS checkbox unchecked by default; **submit disabled until checked** (functional gate; no TOS body).
- *Default:* submit disabled. *Loading:* submit shows pending state on save. *Error:* field-level errors (duplicate email, bad email, empty required field, unchecked TOS). *Empty:* pristine form. *Success:* redirect to the Plan view, logged in.

### 7.3 Connections page
- Inputs: **Canvas domain** (placeholder `school.instructure.com`) and **Canvas access token**. A **Save & Validate** button.
- *Default:* shows current connection status if a credential exists. *Loading:* "Validating…" while the test call runs; inputs disabled. *Error:* the matching FR-5 message (distinct per failure state) with remediation text. *Empty:* no credential saved — prompt to connect Canvas. *Success:* "Connected to Canvas as <name>" with last-validated time and a **Refresh** action.

### 7.4 Plan view (main / default landing)
- Layout: a per-day list/columns for the window, each day showing its SCHEDULED blocks (assignment name → link, allocated hours) under that day's hour budget; plus distinct sections for **At risk** (with shortfall), **Overdue**, and **No due date**. An **hours/day** control and a **Refresh** action are present. Last-sync timestamp shown; stale data is labeled.
- *Default:* current plan rendered with all four buckets. *Loading:* skeleton while syncing/generating. *Error:* sync error banner (FR-7); if cache exists, still render the plan from stale cache beneath the banner. *Empty:* no cached assignments → "No assignments cached yet — connect Canvas and Refresh" (never a fabricated plan). *Success:* freshly generated plan with cleared stale flag and updated sync time.

### 7.5 Account & Settings pages
- **Account:** read-only email; editable full name and phone; Save. States: default / loading (save pending) / error (save failed) / success (saved confirmation). (No "empty" — always populated for a logged-in user.)
- **Settings:** `default_hours_per_day`, `planning_window_days`, `default_effort_hours`; Save. Same state set as Account. Keep lean — no additional toggles.

---

## 8. Data Requirements & Privacy

**Stored locally (SQLite on the student's machine):** user profile (email, full name, optional phone), **plaintext password**, Canvas connection (`base_host` + **plaintext access token**), cached Canvas data (courses, assignments, announcements), generated plans, and app settings. Nothing is transmitted anywhere except direct requests from the local backend to the student's own Canvas instance.

**Security hardening is intentionally deferred.** This MVP does **not** implement encryption at rest, password hashing, token encryption, rate limiting, or any other hardening; all such measures are tracked in `BACKLOG.md`. This is acceptable for this build because the app is single-user, runs only on `localhost`, stores data in a local file on the owner's own machine, and is never deployed or network-exposed — the threat model of a shared/hosted service does not apply. `ASSUMPTION:` the student trusts their own machine and OS-level account security.

**Academic-records sensitivity (flag, not a task here):** the cached assignments/announcements are student academic data that would be **FERPA-relevant in any future non-local, multi-user, or hosted version**. That future scenario is `→ BACKLOG` and out of scope for this MVP; it is flagged here so it is not forgotten when the security/hardening and any hosting work is scoped.

---

## 9. Open Questions & Risks

| # | Item | Decision / current default | Why it's OPEN / the risk |
|---|------|----------------------------|--------------------------|
| Q1 | **Canvas token scope/permissions** | Use a personal access token; expect full read access to courses/assignments/announcements. | `OPEN` — Canvas tokens can be scoped; a too-narrow token passes `/users/self` (FR-5) but 403s on data calls (`insufficient_scope`). Need to confirm required scopes and document how the student issues an adequately-scoped token. Risk: silent partial data → must rely on FR-5/FR-7 surfacing. |
| Q2 | **Planning-window bound** | `ASSUMPTION:` next **7 days** (rolling, inclusive of today), set via `planning_window_days`. | `OPEN` — alternatives: "all upcoming" (unbounded) or a student-chosen horizon. Affects G1's definition of "in window" and plan size. |
| Q3 | **Per-assignment effort estimate** | `ASSUMPTION:` flat **2.0 h** per assignment (`default_effort_hours`). | `OPEN` — the rule engine needs a duration to allocate hours; Canvas provides none reliably. Alternatives: derive from `points_possible`, assignment type, or manual per-assignment entry. Wrong estimates distort allocation (but never cause omission). |
| Q4 | **Hours input granularity** | `ASSUMPTION:` one hours/day value applied uniformly (recommended for MVP). | Per-day-varying hours is deferred (`→ BACKLOG`); confirm the uniform model is acceptable. |
| Q5 | **Completion/submission awareness** | MVP does **not** read submission status; already-submitted work may appear. | `OPEN` — pulling submission state could de-clutter the plan, but mis-filtering risks dropping an item and breaking G1. Chose the safe (show-everything) option for MVP; revisit. |
| Q6 | **Multiple Canvas accounts / re-connect** | One Canvas credential per user; re-saving overwrites it. | Multi-account is `→ BACKLOG`; confirm single-account is sufficient for the target student. |
| Q7 | **Canvas API/version drift** | Endpoints in §6.3 per stable Canvas REST v1. | Risk: an institution's Canvas may differ slightly. Mitigation: agent verifies against `canvas.instructure.com/doc/api/` before build; FR-5/FR-7 surface failures rather than crashing. |

---

*End of PRD. The backlog is intentionally **not** included here; it will be produced as a separate `BACKLOG.md` on the follow-up prompt. All `→ BACKLOG` markers and deferred items above are the inputs for that file.*
