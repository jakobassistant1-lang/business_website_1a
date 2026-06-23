# Navo — Study/Work Scheduling v1 Spec

**Status:** design, ready to build on request. Derived from the scheduling-plan calibration + the academic-planner gap review (both with Calvin) and grounded in [`navo-study-scheduling-research.md`](./navo-study-scheduling-research.md). Builds on the existing `generatePlan` (EDF + importance-weighted slack) in `lib/scheduler.ts` and the prioritizer in [`navo-priority-v1-spec.md`](./navo-priority-v1-spec.md) / `lib/marginalPriority.ts`.

---

## 1. Objective & scope

Turn the prioritized assignment/assessment list into a **day-by-day plan of study + work blocks** that applies the evidence-based practices we can act on — **spacing, ≤1h sessions, review-then-relearn, realistic time budgeting** — while respecting the daily time budget and deadlines, and **degrading gracefully under contention**.

**In scope:** across-day distribution of study/work, session count + sizing + sequencing, deliverable chunking, effort budgeting, and competing-assessment allocation.

**Explicitly OUT of scope (Calvin's calls):** sleep/time-of-day/circadian placement; habits/streaks/motivation nudges; **variable per-day availability** (no clean non-clunky input yet); deliverable **phase/dependency** modeling; **per-session content/topic mapping** (that lives on the assessment's study page — future). These are deliberate omissions, not oversights.

---

## 2. Two work types schedule differently

| | **Deliverables** (homework, essays, projects) | **Assessments** (exams, quizzes) |
|---|---|---|
| Nature | One body of work you submit | Nothing to submit — you must *study* |
| Scheduling | **Chunk** into ≤1h blocks across days before the due date | **Expand into a spaced sequence of ≤1h study sessions** |

---

## 3. Lead windows (defaults — user-tweakable)

How far before the assessment study may begin:

| Type | Lead cap | Source |
|---|---|---|
| Quiz | **3 days** | existing `User.studyDaysQuiz` |
| Exam / test (non-cumulative) | **7 days** | existing `User.studyDaysTest` |
| Midterm / final (cumulative) | **14 days** | NEW `User.studyDaysFinal` (default 14) |

- **Detection:** `itemType` already yields `exam`; sub-classify **midterm/final/cumulative** by name (regex on "midterm", "final exam", "cumulative") → 14-day tier; other exams → 7; quizzes → 3.
- **Effective window** `L = min(daysUntilAssessment, leadCap)`. (A final 30 days out still starts at most 14 days before; a final 5 days out uses 5.)

---

## 4. The spacing engine (assessments) — the core

Given the effective window `L`, the **inflated** study hours `H` (§6), and the type:

**a) Number of sessions `N`** — enough ≤1h sessions to cover `H`, never fewer than the type minimum:
```
N = clamp( ceil(H / MAX_BLOCK), typeMin, MAX_SESSIONS )
MAX_BLOCK   = 1.0 h      typeMin = { final: 4, exam: 3, quiz: 2 }
MAX_SESSIONS ≈ 12        (a backstop; very heavy loads cap here)
```
**The 1h cap is per *session*, not per *day*** — heavy loads get multiple ≤1h sessions.

**b) Session days** — distribute the `N` sessions across `[−L, −1]`:
- Prefer **even gaps, one session per day**, always anchoring a **light session on day −1**.
- When `N > L` (heavy load), place extra sessions on additional days, **2 per day max**, and **separate same-day sessions** (not back-to-back). **Spread across days first; double up only when the load forces it.**

**c) Session sizes** — a **discretized normal (bell) distribution** over the ordered sequence: light first (the review), **peak in the middle**, lightest last (day-before). Each block capped at `MAX_BLOCK`; if the cap clips the peak, that excess is what pushes `N` up in (a). Sample weights (× `H`):
```
N=2 → 0.50 / 0.50      N=4 → 0.20 / 0.30 / 0.30 / 0.20
N=3 → 0.25 / 0.45 / 0.30   N=5 → 0.15 / 0.25 / 0.30 / 0.20 / 0.10
N=6 → 0.12 / 0.20 / 0.24 / 0.20 / 0.14 / 0.10
```
*(Front-loading is technically optimal but students won't follow it — the bell ramps in gently, which they will.)*

**d) Session content/type:**
- **Session 1 = material review / re-read** (re-familiarize — for most students it's the first look since they took the notes).
- **Sessions 2…N = successive relearning** — open by retrieving the prior session's material, then extend. **Time-boxed** (not criterion-based — a deliberate simplification).

---

## 5. Deliverable scheduling

- **≤1h → one block**, placed before the due date. (No forced buffer-day — finishing on the due date is acceptable.)
- **>1h → split into ≤1h blocks across multiple days** before the due date.
- **Genuinely unsplittable >1h work → one longer block + an intermittent-break reminder.**

---

## 6. Budgeting

- **Inflate every effort/study estimate ×1.2** (planning-fallacy correction) before scheduling. This same inflated estimate should feed the prioritizer's effort term for consistency. *(Per-user calibration of the multiplier = future.)*
- **Schedule to 90% of the daily budget** (`User.defaultHoursPerDay`) — leaving ~10% headroom for overruns/catch-up.

---

## 7. Placement hierarchy (unchanged engine, new preference layer)

The existing `generatePlan` already does levels 1–2; spacing is the new level 3.

1. **Feasibility [hard]** — every deadline still makes it (the EDF deadline floor). Untouched.
2. **Priority [scarcity]** — when the week is over-budget, the prioritizer's **marginal value** (grade-weight × leverage) decides what's protected. Untouched.
3. **Spacing [preference]** — in the *slack*, place each generated session on its target day; if full, shift to the nearest **earlier** open day (preserve spacing). Under crunch the sequence **collapses gracefully** toward the deadline — never worse than today's behavior.

---

## 8. Competing assessments / contention

When several assessments' (and deliverables') ideal sessions exceed available time (e.g. finals week), resolve in this order — **using the prioritizer's marginal value as the allocation currency:**

1. **Build each assessment's ideal plan independently** (§4), then reconcile only where they collide.
2. **Allocate contested study time by class standing (Calvin #4).** Under contention, the available study time is split across competing exams **in proportion to their marginal value** (`grade-weight × leverage`), so **at-risk classes (low grade) keep their sessions and aced classes get trimmed first** — *partially* (floors below), and **only when conflicts arise** (a non-crunched week uses the full estimate per exam).
3. **Compress spacing-preservingly.** When it still doesn't fit, **drop interior sessions but keep session 1 (review) and the day-before review, holding a gap** — reduce the *count* before the *spacing*. Four spaced sessions beat six crammed.
4. **Floor every real exam** — never zero: keep **≥2 sessions (exam) / ≥1 (quiz)** even when squeezed.
5. **Nearer + higher-value exam wins contested slots;** the farther exam shifts earlier or drops an interior session (it has runway to recover).
6. **Free time by deferring low-value deliverables** — the prioritizer already flags low-weight, forgiving-late work; let those slip to protect high-stakes prep rather than stealing from study.
7. **Surface the crunch + hand over the levers.** If the week genuinely can't hold adequate spaced study, **say so** ("Calc and Bio exams both Thursday — here's what's compressed") and offer: start earlier, add daily hours, or accept lighter prep on the lowest-stakes item. **Never degrade silently.**

---

## 9. Decisions locked in the gap review (kept as-is)

- Deliverables may **finish on the due date** (no buffer rule).
- **Uniform daily budget** — variable per-day availability is out of scope.
- A **single retrieval session is fine for a quiz**.
- **Material-availability not modeled** — trust the student's judgment on what's ready to study.
- **Session 1 = review/re-read** (not encode-then-test) — realistic first look.
- **Time-boxed**, not criterion-based.
- Scheduler sessions carry **no topic/content map** — the per-assessment study plan surfaces on the study page (future).

---

## 10. Integration points

- **`lib/scheduler.ts` (`generatePlan`)** — replace the continuous `studyLeadDays` window with the **discrete spaced-session expansion** (§4); add the ×1.2 inflation + 90% headroom (§6); add the contention/grade-allocation layer (§8). Keep EDF + slack mechanics.
- **`lib/itemType.ts`** — add midterm/final detection for the 14-day tier (§3).
- **`prisma/schema.prisma`** — add `User.studyDaysFinal` (default 14).
- **`lib/calendarData.ts`** — thread the assessment type + `Course.currentScore` (already synced) + inflated effort into the scheduler; expose the generated sessions to the UI.
- **`lib/marginalPriority.ts`** — reused as the contention currency (no change); its effort term consumes the ×1.2 estimate for consistency.

---

## 11. Acceptance criteria

A v1 must reproduce the **validated sample week**:
- 2.4h essay → **3 ≤1h blocks** across the days before its due date.
- Quiz (3-day lead) → **2 sessions: review then recall**.
- Midterm (7-day window) → **bell-sized ≤1h sessions across the week** (review first, retrieval after, light day-before).
- Every day **≤90% of the budget**; nothing exceeds **1h per session**.

And a **contention test**: two overlapping exams, one in an A-class and one in a C-class, over a budget that can't fit both ideal plans → the **C-class keeps its sessions, the A-class compresses (spacing-preservingly, to its floor), and the over-capacity is surfaced.**

---

## 12. Parked / future (explicit, not v1)

- **"I missed this" → re-plan** (study-block completion tracking + re-flow on slippage).
- **Obvious path to each assessment's study page from any view**, with its study plan shown there.
- **Per-user planning-fallacy multiplier** calibration (learn estimate-vs-actual).
- **Variable per-day availability** (from the calendar).
- **Per-session content/topic mapping** (from Canvas modules/syllabus) → unlocks real **interleaving** and "review the prior session" with actual material.

---

## 13. Tuning knobs

Lead caps (14/7/3) · type minimums (4/3/2) · `MAX_BLOCK` (1h) · `MAX_SESSIONS` (~12) · bell-weight vectors · inflation (1.2×) · daily headroom (90%) · the contention allocation/compression order. Calibrate against the sample week + the contention test, same as the priority constants.
