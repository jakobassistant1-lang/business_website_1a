# Guided Canvas Onboarding — Build Plan

Branch: `guided-canvas-onboarding` · Target: `main` → Vercel (pinnavel.com)

## 1. Goal
Cut the #1 activation drop-off — connecting Canvas. Replace the two blank fields
("Canvas domain" + "paste token") with a guided flow:

1. **Pick your school** from a searchable dropdown → we auto-fill the Canvas domain.
2. **Or enter it manually** ("My school isn't listed") → the current host field.
3. **One button to the right Canvas page** + clear, always-visible steps to create the
   access token (so a non-technical student actually understands how).
4. **Paste + validate** (existing, unchanged behavior).

## 2. Success criteria
- A student can connect without knowing their Canvas URL or what a "token" is.
- Dropdown is type-to-filter, keyboard-accessible, with a manual fallback always reachable.
- Token step deep-links to the student's own Canvas settings + explains the steps inline.
- Zero regression to the validate → encrypt → upsert API contract.
- `npx tsc --noEmit`, `npm test`, `npm run build` all green; dark mode + keyboard verified.

## 3. Scope (what we build)
1. **`lib/schools.ts`** — typed `SCHOOLS: School[]` dataset (name, aliases, host) + pure
   `filterSchools(query, limit)` search. Data from the research agent (verified hosts only).
2. **`components/SchoolPicker.tsx`** — accessible combobox: type-to-filter, ↑/↓/Enter/Esc,
   click-select, "no match → enter manually" affordance.
3. **`components/ConnectionsForm.tsx`** — rework into guided steps (school → token → result),
   reusing the existing design-system classes and the existing POST/validate flow.
4. **`tests/schools.test.ts`** — Vitest coverage for `filterSchools`.
5. **Docs** — README + CLAUDE.md connection blurb; fix the stale "stored in plaintext"
   hint (tokens are encrypted at rest now via `lib/crypto.ts`).

## 4. Non-goals (to stay surgical)
- No change to `lib/canvas.ts`, the FR-5 validation matrix, encryption, or the schema
  (the `host` string is sufficient — no `schoolName` column / no migration).
- No OAuth or browser-extension (separate roadmap; documented as the durable path).
- No analytics stack — funnel instrumentation is a **documented fast-follow** (the repo has
  none today; adding one is its own decision, not this PR).
- No "found N courses" on validate (would require the validate route to fetch courses;
  noted as an optional follow-up).

## 5. Files & data flow (no DB migration)
```
lib/schools.ts            NEW  data + filterSchools() (pure, tested, client-safe: no node imports)
components/SchoolPicker.tsx NEW combobox (client component)
components/ConnectionsForm.tsx MODIFY  integrate picker + manual toggle + token step
tests/schools.test.ts     NEW  filter logic
README.md / CLAUDE.md      MODIFY  short connection-flow update
```
Host still flows: ConnectionsForm → POST /api/canvas/credentials → normalizeHost →
validateCredentials → encryptSecret → upsert. **The API route is untouched.**

## 6. ConnectionsForm — state design
- `step: "choose-school" | "get-token"`; `mode: "picker" | "manual"`.
- **choose-school / picker:** `<SchoolPicker onSelect={(s)=>{setHost(s.host); setStep("get-token")}} />`
  + a link "My school isn't listed — enter the link manually" → `mode="manual"`.
- **choose-school / manual:** the existing host `field` + "Continue" → `step="get-token"`;
  a "← Back to school list" link → `mode="picker"`.
- **get-token:** show the resolved host (with a "change" link back to choose-school), a
  primary **"Open Canvas to get your token ↗"** button (`https://<host>/profile/settings`,
  `target="_blank" rel="noopener noreferrer"`), the always-visible numbered steps, the
  token `field`, and **"Save & validate"** (existing POST). Result pill + `messageFor`
  message reused as-is; on `valid`, keep the "Connected · <accountName>" pill.
- Re-entry: if `initial.hasToken`, start on `get-token` with the saved host shown (edit/replace).

## 7. SchoolPicker — accessibility & behavior
- `input[role=combobox]` with `aria-expanded`, `aria-controls`, `aria-activedescendant`;
  `ul[role=listbox]` of `li[role=option]`. ↑/↓ move active option, Enter selects, Esc closes,
  blur closes, click selects. Filter via `filterSchools`; cap rendered to ~50 for perf.
- Empty/no-match row: "Can't find your school? Enter your Canvas link manually" → switches the
  parent to manual mode. Styling mirrors `GoogleCalendarCard` / existing `field` + `card` classes.

## 8. School database
- Source: background research agent → `school-canvas-domains.json` (verified `canvasHost`,
  `aliases`, `confidence`, `source`). Transform into `lib/schools.ts`.
- Bundled statically (hundreds of entries ≈ tens of KB, fine). **If it grows to thousands,**
  move search to an API route (`/api/schools?q=`) — noted, not now.
- Honesty: it's a curated starter set, **not exhaustive**; manual entry is the universal fallback.

## 9. Testing & verification (repo dev loop)
- `tests/schools.test.ts`: name match, alias match, case-insensitivity, ranking (prefix > substring),
  empty query, no-match, limit cap.
- `npx tsc --noEmit` · `npm test` · `npm run build` — all green.
- Manual: `npm run dev` → `/connections`: picker filter, select, manual toggle, deep link opens
  the right host, validate success + each error state; dark mode; keyboard-only navigation.
- Then `/design-review` and `/code-review`; fix findings.

## 10. Risks & mitigations
1. **Wrong Canvas host in DB → failed connect.** Verified-only entries + `confidence` +
   manual fallback + the existing clear `bad_domain` message.
2. **Combobox a11y bugs.** Build to the ARIA combobox pattern; keyboard-test.
3. **Bundle size if the list is large.** Cap rendered results now; API search later.
4. **Deep-link can't auto-open the token dialog.** Link to `/profile/settings` and spell out
   "click + New Access Token" — don't over-promise an anchor that may not exist.
5. **Personal-token dependency** (some schools are disabling student tokens). Documented;
   OAuth/extension remains the durable path.

## 11. Follow-ups (not in this PR)
- Funnel instrumentation (signup → domain → token-page → paste → valid → first plan).
- "Found N courses" on validate for instant proof-of-success.
- OAuth per-school; companion browser extension.
- Server-side school search if the dataset grows large.

## 12. Review resolutions (incorporated before build)
- **M1 — re-validate/token:** already-connected users (`status==="valid"`) see a compact Connected
  state (host + accountName) with a **Change connection** button; token stays `required` whenever
  the flow actually submits. No "validate without token" path → no API change.
- **M4/M5 — host normalize + client-safety:** extract pure `lib/host.ts` `normalizeHost()` (no node
  imports); `lib/canvas.ts` imports + re-exports it (route import unchanged); `lib/schools.ts`
  normalizes every host at load; the deep-link URL uses the normalized host. `lib/schools.ts` =
  static array + pure functions only.
- **M2 — deep link:** `target="_blank" rel="noopener noreferrer"` (both).
- **M3 — XSS:** school names/aliases rendered as React text (split+`<strong>` for highlight),
  never `dangerouslySetInnerHTML`.
- **M6/M7 — combobox a11y:** clear `aria-activedescendant` when `aria-expanded=false`; Esc closes +
  returns focus to input; select closes + keeps focus on input.
- **M8/S2/S3 — client guards:** block empty/whitespace token (and manual host) before fetch; clear
  `message`/`status`/`accountName` on step/mode/host change.
- **S1/N1 — styling:** reuse `btn-primary`/`btn-ghost`/`card`/`field`/`label`/`toneSoft`; the listbox
  is new UI styled with existing tokens (verify names in globals/tailwind before use).
- **S4 — copy:** replace the stale "stored in plaintext" hint with "Your token is encrypted and only
  used to read your Canvas coursework."
- **S5 — cap:** `filterSchools(query, limit=50)` enforces the cap (tested), not the component.
- **S6 — picker query:** reset the picker's internal query when (re)entering picker mode.
- **S7 — bundle:** static now; if minified `lib/schools.ts` > 50 KB, move search to `/api/schools?q=`.

