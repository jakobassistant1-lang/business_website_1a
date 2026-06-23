# Navo — Assignment Prioritization v1 Spec

**Status:** design, ready to build on request. Derived entirely from the revealed-preference
elicitation in [`navo-priority-preferences.md`](./navo-priority-preferences.md) (25 pairwise
questions + 3 validation scenarios). Functional *forms* below are fixed; the numeric
*constants* are starting values to be **fit so the model reproduces every answer in the
acceptance set** (§8). This replaces the weighted heuristic in `lib/priority.ts`.

---

## 1. Objective

Order a student's active work to **maximize expected total grade (GPA impact) per hour of
effort**, recomputed every day. A task's priority is the **marginal grade-% it puts at stake
right now**, per hour to do it. There are **no hard tiers** — "overdue-first," "imminent,"
"undated-last" all fall out of the one score and self-correct at the edges (validated A/B/C).

---

## 2. The score

Everything — assignments *and* study sessions — is ranked by one number:

```
score(i) = leverage(g_c) · capture(i) / max(effort_hours(i), ε)        // expected grade-% per hour
```

`capture(i)` is the grade-fraction the item puts at stake *now*, and differs by kind:

```
# Assignment (a thing you submit):
capture = weight · [ λ + (urgency(dDue) − λ) · slipLoss(latePolicy_c) ]

# Study (prep for an exam/quiz):
capture = weight · (1 − g_c) · ramp(dExam)
```

- `weight` — the item's **share of the final course grade** (a fraction). NOT raw points (Q25).
- `g_c` — current grade fraction in the course (e.g. 0.72 for a C).
- `dDue` / `dExam` — days until the due date / the exam (negative = overdue).
- `ε` — small floor so 5-minute tasks don't divide to infinity (e.g. 0.1 h).

Why the shapes:
- **Assignment.** `λ` is the item's *inherent* value (you'll do it eventually → ranks non-urgent
  items by weight, Q3). `urgency(dDue)` adds deadline pressure as it nears. `slipLoss` scales the
  *pressure only* (not the inherent value) by how much a one-period slip actually costs, so a
  forgiving late policy relaxes the deadline (Q11, Scenario B) but the work still carries its weight.
- **Study.** `(1 − g_c)` is the **improvement headroom** — studying only buys what you don't already
  know (Q17, Q18). `ramp(dExam)` is study urgency, ~0 when the exam is far and climbing steeply as it
  nears (Q16/Q20/Q8). Because the score also multiplies by `leverage(g_c)`, study effectively scales
  with `(1−g_c)·leverage(g_c)` ≈ (1−g)² — so studying for a class you're **acing self-parks**
  (Scenario C: the 30% A-class final sat at the bottom). Intended.

---

## 3. Factor definitions (form fixed · constants to fit)

| Factor | Form (starting) | Data source | Default if unknown |
|---|---|---|---|
| **weight** | group-weighted: `group_weight · points / Σ(points in group)`; else points-based: `points / Σ(course points)` | Canvas `assignment_groups.group_weight`, `points_possible` | **type proxy** (exam .25 / project .20 / quiz .08 / homework .05 / discussion .03 of grade) |
| **leverage(g)** | `clamp(1 − g, 0.10, 1)` | Canvas enrollment `current_score` (per course) | `g = 0.75` → leverage ≈ 0.25 (neutral-ish) |
| **urgency(d)** | plateau-then-cliff: `1` for `d ≤ 1`; linear `1 → λ` over `1 < d < D_cold`; `λ` for `d ≥ D_cold`. Overdue (`d ≤ 0`) → `1`. `D_cold ≈ 3`, `λ ≈ 0.04` | due date | n/a (no due date → urgency = λ; see §5 undated) |
| **slipLoss(late)** | fraction lost by slipping one period: none → `1`; flat-X% → `X`; −P%/day → `P` (per day) | **Gemini-parsed syllabus** (per course), cached | `1` (assume no late credit) |
| **(1−g)** improvement | `1 − g_c` (headroom) | same as leverage | `0.25` (from default g) |
| **ramp(d)** | study urgency: `1` for `d ≤ 1`; linear `1 → 0` over `1 < d < D_study`; `0` beyond. `D_study ≈ 5` | exam date (from study plan) | n/a |
| **effort_hours** | AI estimate | `lib/analysis.ts` (existing) | bucket fallback (quick 1h / med 3h / long 6h) |

All constants (`λ`, `D_cold`, `D_study`, leverage floor, type-proxy weights) are **fit to §8**, not final.

---

## 4. From scores to a plan — the two regimes

Scoring ranks items; turning that into a daily plan depends on whether the work **fits** the
student's time budget (the existing `hoursPerDay`). Both regimes were validated (Q22, Q24, B).

- **Slack (everything fits):** schedule by **EDF** (earliest deadline first) so every deadline is
  met; use `score` (ROI) to break ties and to pull **quick wins** early (Q13, Q22-slack, Scenario A:
  the 15-min discussion before the 40-pt set).
- **Scarcity (over budget):** allocate hours to **highest `score` first**, but because returns
  **diminish**, *split* time rather than dumping it all on #1 — specifically protect items facing a
  **catastrophic zero** (no-late-credit, high weight) with partial allocation (Scenario B refinement:
  carve essay time from the study block when History has no late credit). Equivalent to: greedily fill
  hours by *marginal* grade-%/hr, re-evaluating after each block.

This is the existing `lib/scheduler.ts` job. **Keep `generatePlan`'s EDF + weighted-slack split;
replace its weight** (`sqrt(points) · importanceMult`) **with this `score`** (marginal grade-%/hr).

---

## 5. Edge cases (all fall out of §2 — no special tiers)

- **Overdue (recoverable):** `urgency = 1`, but `capture = weight · slipLoss` and `× leverage` — so a
  small, forgiving-late, locked-A overdue item **correctly sinks** (Scenario A/e); a big, no-credit,
  at-risk one floats up. Overdue is marginal, not auto-top (resolves Q9).
- **Overdue (dead / 0 credit, `slipLoss = 0` and already past):** capture → 0 → **drop from the list**
  (don't surface unwinnable points).
- **Undated:** no due date → `urgency = λ` (no deadline pressure) but `weight` is real → a **low but
  nonzero** score. Ranks **above** near-zero-marginal work during slack (Scenario C: undated reading
  above an A-class final's study) and **below** anything ramping/imminent; reverts as others' scores
  rise (scores are time-dependent, recomputed daily). No ≥5-day-gap rule needed — it emerges.
- **Submitted / done:** excluded from the active set (existing `isDone` logic in `lib/calendarData.ts`).
- **Missing data:** every factor **fails open** to its §3 default (no grade → neutral leverage; no
  weight → type proxy; no late policy → no-credit; no effort → bucket). Never throws. Matches the app's
  fail-open AI philosophy.

---

## 6. Data & infrastructure changes (the only new plumbing)

1. **Current course grade** — fetch Canvas enrollment `current_score`/`current_grade` per course at
   sync; store per course; feeds `leverage` and study `improvement`. *(New Canvas call.)*
2. **Grade weights** — fetch `assignment_groups` (`group_weight`, member points) per course; compute
   each item's `weight`. Cache; recompute on sync. *(New Canvas call; falls back to points-of-total,
   then type proxy.)*
3. **Late policy** — new Gemini step: parse the **already-fetched syllabus** (`fetchSyllabus`) per
   course into `{ kind: "none"|"flat"|"perday", value }`. Mirror `lib/analysis.ts` (batched, cached by
   syllabus hash, fails open to `none`). *(New AI step; default no-credit.)*
4. Effort hours, type, due date, points — **already present**.

---

## 7. Integration points (files)

- **`lib/priority.ts`** — replace `scoreAssignments` with §2 `score`; rewrite `priorityInputs…` to
  carry `weight`, `g_c`, `slipLoss`, `dExam`. Keep the public ranking shape so callers are unaffected.
- **`lib/scheduler.ts`** — swap `generatePlan`'s weight for `score`; keep EDF + slack-split mechanics.
- **`lib/analysis.ts`** (or a sibling `lib/latePolicy.ts`) — add the syllabus→late-policy parse.
- **Canvas sync layer** — add the grade + assignment-group fetches; persist on the course rows.
- **`prisma/schema.prisma`** — add `currentScore`, `latePolicy` (json), and per-assignment
  `gradeWeight` (or compute on read).
- **`lib/calendarData.ts`** — thread the new fields into the inputs; `isDone` unchanged.

---

## 8. Acceptance tests — v1 MUST reproduce all of these

Encode the elicitation as fixtures; tune §3 constants until the produced order matches. Source rows
in [`navo-priority-preferences.md`](./navo-priority-preferences.md).

**Pairwise (Q1–Q25)** — the model's `score` must order each pair the way Calvin did, e.g.:
- Q1–Q4: an imminent (≤2d) item beats a far one even at ~13× the weight; but Q3: among non-imminent
  items, weight wins.
- Q5/Q16/Q17/Q20: study-vs-do crossovers (100-study > 50-assign at 3d; < 75-assign when time-scarce;
  loses to 50-assign when the exam is 5d out).
- Q9 + Scenario A/e: recoverable-but-trivial overdue sinks.
- Q11 + Scenario B: forgiving late → defer the big item; no late credit → don't fully drop it.
- Q15/Q21: grade-leverage beats a 2× weight gap.
- Q25: exam > higher-point quiz (via weight, not points).

**Scenarios (end-to-end ordering):**
- **A — typical Tuesday** (8 items): a > b > c > d > g > f > e > h.
- **B — crunch night** (scarcity): protect Calc-study + Bio-hw + Calc-disc; **defer** the 80-pt
  History essay; carve essay time from study **iff** History has no late credit.
- **C — light week** (slack): grind Bio midterm; **park** the 30% A-class final; undated reading
  above the final's study.

A v1 that fails any of these is not done.

---

## 9. Tuning knobs & open questions

- **Constant fitting:** `λ`, `D_cold`, `D_study`, leverage floor/curve, type-proxy weights — fit to §8.
  If no single set satisfies all 25+3, surface the conflicts (likeliest tension: Q2's near-absolute
  imminence vs Q3's weight-ordering — handled by the plateau-then-cliff `urgency`, but verify).
- **Leverage curve:** linear `(1−g)` is the starting guess; may need a gentler curve so locked-A
  classes aren't *too* suppressed (they're floored at 0.10). Calvin confirmed it beats 2× (Q21); upper
  bound on how far is untested.
- **Diminishing-returns split (scarcity):** model studying's per-hour return as decreasing so the
  scheduler naturally splits (Scenario B). Exact curve = a tuning target.
- **Late-policy parse reliability:** Gemini may misread odd syllabi → always defaulting safely to
  no-credit; consider surfacing the parsed policy in the UI for the student to correct.
- **Weighted vs points-based courses:** confirm the `group_weight` path on a real Canvas course in the
  sandbox before trusting it; fall back cleanly.

---

## Build status (2026-06-22)

**Shipped (code complete, `tsc` clean, 205 tests green):**
- `lib/marginalPriority.ts` — the scorer (§2). Tuned to reproduce the acceptance set; `tests/marginalPriority.test.ts` (22) encodes Q1–Q25 + the validated scenario relations.
- `lib/gradeWeight.ts` — points → **share of course grade**, weighted-group + points-based, normalized per course (Calvin's different-totals constraint); `tests/gradeWeight.test.ts` (9).
- `lib/latePolicy.ts` — the simple 3-enum policy + the Gemini syllabus reader; `tests/latePolicy.test.ts` (12).
- `lib/rankActive.ts` — adapter: synced rows → marginal ranking in the existing `ScoredAssignment` UI shape. Computes the points→% share from rows already in the DB.
- **Wired live:** `lib/calendarData.ts` (Dashboard / recommendations / Timeline) and `lib/demoData.ts` (first-run demo) now rank via the v1 model. `ScoredAssignment.factors` is now optional (no UI reads it).

**Fail-open until synced:** current grade → neutral leverage; late policy → no-credit; weighted-group weights → points-of-total, then type proxy. So the new ranking is already live using points→% + imminence-tier + study-curve + undated-backfill; grade-leverage and real late policy switch on once the data lands.

**Added after real-data (sandbox) review:**
- **Dated-first rule** (`rankItems`): an item with a due date always outranks an undated one regardless of weight — undated work is backfill. Supersedes the earlier Scenario-C nuance (undated reading > a zero-value far study). Fixed an undated 50%-of-grade participation item ranking #1.
- **Gentle urgency tail** (`URGENCY_CURVE` out to ~30 days): among the non-imminent pile, sooner-due beats later-due (a thing due in 7 days > one due in 42), instead of everything past 3 days collapsing to weight-only.
- **`requiresOnlineSubmission(submission_types)`** in `lib/itemType.ts`: free Canvas signal for "no online submission." NOTE proven insufficient alone — in-person exams report `none` too, so it can't exclude on its own.

**Not yet done (needs decisions):**
1. **Non-actionable screen (AI):** drop participation / engagement / attendance / placeholder-grade items from the ordering, KEEPING readings + in-person exams. Two gates: keep if `requiresOnlineSubmission` OR Gemini `requiresAction` (fail toward keep). Add `requiresAction` to the existing `lib/analysis.ts` batch + an `aiRequiresAction` column. Real-data motivation: "Class Engagement/Participation" (1500pt, dated) still ranks #2 and only the AI screen can drop it.
2. **Schema migration + new fetches** — current grade (`current_score`), weighted-group weights (`assignment_groups`), late policy (Gemini/syllabus), AND `aiRequiresAction` (#1). One Neon `prisma db push` (prod schema-sync caution).
3. **Scheduler weight swap** — feed `schedulerWeight` into `generatePlan`'s slack split (the RANK already uses v1; the day-by-day plan still uses the old weight).
4. **Overdue-default** decision (parked): with no-late-credit default, overdue items score 0 (treated unrecoverable). They still appear in the catch-up rail.
5. **Live browser verification** once a real account is synced (verified so far via the test suite + the sandbox ranking script + the demo path).

## 10. Out of scope for v1

Per-student learning/feedback (adjusting constants from what the student actually does first),
multi-day study spreading beyond what `generatePlan` already does, and confidence/baseline overrides
better than "baseline ≈ current grade." All are v2 candidates.
