# Gemini quota — what the owner must check (#126)

Navo uses ONE Google Gemini API key (`GEMINI_API_KEY` in Vercel) for every AI
feature, on the model **`gemini-2.5-flash`** (set in `lib/geminiFetch.ts`). If
that key's quota runs out, every student's AI features degrade at once. The code
half of #126 is done (see "What the code already does"); the two checks below
need your Google login, so only you can do them.

## 1. Check the key's tier and limits (5 minutes)

**Status 2026-09-27: the key is on Tier 1 (billing attached), confirmed by the owner.** The burst test below is optional at Tier 1; the two alerts in §2 are still worth setting.

1. Open **Google AI Studio** → <https://aistudio.google.com/apikey>.
2. AI Studio's key list shows every key on your account with its **project**
   name and creation date. Navo's is the one you created for the app (if there
   are several and you're unsure, it's the one whose usage graph moves when you
   generate a study guide in Navo). Note which **Google Cloud project** it belongs to. Don't
   copy the key itself anywhere.
3. In AI Studio open **Usage & billing** (or <https://aistudio.google.com/usage>)
   and pick that project. Write down:
   - the **tier** — "Free" or "Tier 1/2/3" (Tier 1+ means billing is attached);
   - for **gemini-2.5-flash**: **RPM** (requests per minute), **RPD** (requests
     per day) and **TPM** (tokens per minute).
4. What "enough" looks like: the free tier's limits for 2.5 Flash are small (on
   the order of 10 RPM / a few hundred RPD — check the live number, Google changes
   them). One busy student can make ~10 calls in their first minute (sync +
   analysis rounds + a study page). **If the key is on the free tier, attach
   billing to move it to Tier 1 before launch.**

## 2. Set a usage alert

Two alerts, both in the **Google Cloud Console** for the project found above
(<https://console.cloud.google.com>, pick the project at the top):

- **Spend alert:** Billing → **Budgets & alerts** → Create budget → scope it to
  this project → set a monthly amount (e.g. $20) → alert at 50% / 90% / 100% →
  email to you. (Only matters once billing is attached.)
- **Quota alert:** IAM & Admin → **Quotas & System Limits** → filter for
  "Generative Language API" → tick the gemini-2.5-flash requests-per-minute and
  per-day rows → **Create usage alert** at 80%.

To eyeball traffic at any time: APIs & Services → **Generative Language API** →
Metrics → "Traffic by response code". A growing band of **429** responses means
the quota is being hit.

## 3. Burst test (needs the sandbox connected first)

Goal: prove a realistic burst stays under the RPM limit, and that a repeat sync
sends **no** late-policy calls.

Before you start (one-time setup):

1. Start the local Canvas sandbox (the `canvas-lms` Docker stack, <http://canvas.docker>).
2. Refresh its coursework — the last seed's due dates (Jun 15 – Aug 9 2026) are in
   the past. From `~/Projects/Canvassolution`:
   `docker cp scripts/_canvas-seed.rb canvas-lms-web-1:/tmp/ && docker exec canvas-lms-web-1 bundle exec rails runner /tmp/_canvas-seed.rb`
   (safe to re-run; edit the date window at the top of the script first).
3. The app-side sandbox token **expired 2026-06-24**. In the sandbox Canvas:
   Account → Settings → **+ New Access Token** → copy it, then paste it on the
   local Navo bench's Connections page (bench = the `navo-prodbuild-devdb`
   preview on port 3100, which uses the DEV database — never prod).

The test:

1. Open the Cloud Console Metrics page from step 2 in another tab.
2. On the bench, press **Sync** once and wait for it to finish. Expect: 1
   late-policy call (first read of the syllabi) plus up to 6 analysis calls.
3. Press **Sync** again right away. Expect: **0 late-policy calls** and 0
   analysis calls (both are hash short-circuited when nothing changed).
4. Open 3 study pages quickly (each generates a plan/guide). Expect a few calls
   each, no 429s.
5. In Metrics, confirm the peak minute stayed below the RPM limit and there were
   no 429s. If there were, the fix is the tier (step 1), not code.

## What the code already does

- **Late-policy hash (#126):** each course stores a sha256 of the syllabus text
  its late policy was read from (`Course.latePolicyHash`). A sync only sends
  courses whose syllabus changed; a failed read stores nothing so it retries next
  sync (`lib/latePolicy.ts` `latePolicyWorkToDo`, tested in `tests/latePolicyHash.test.ts`).
- **Assignment analysis** is hash-cached per assignment and capped at 8 calls per
  user per minute (#128/#129).
- Every Gemini call retries 429/503 up to 3 times with backoff (`lib/geminiFetch.ts`).

## What students see when the quota runs out (fail-open, today)

Nothing breaks and no error banner appears: sync still succeeds; new assignments
keep a flat default effort estimate and no one-line summary; a new or changed
syllabus keeps its previous late policy (or the strict "no late credit" default
if it was never read); the AI coach summary is missing; on a
study page the Generate step shows "The AI service had a hiccup — try again in a
minute." Everything fills in by itself on a later visit once the quota recovers.
