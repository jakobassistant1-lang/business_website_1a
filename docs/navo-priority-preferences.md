# Navo — assignment prioritization: revealed preferences (in progress)

Eliciting Calvin's "what would you do first?" preferences via pairwise comparisons,
then encoding an ordering algorithm that reproduces them. Current ranking lives in
`lib/priority.ts` (weighted score: 40 urgency / 25 impact(points) / 25 risk / 10 effort;
AI importance 1–5 only nudges the scheduler's slack, not the rank; type isn't a factor;
undated items sink).

> **The formal build spec derived from this log lives in [`navo-priority-v1-spec.md`](./navo-priority-v1-spec.md).**

## Answers log

| # | A | B | Picked | Tells us |
|---|---|---|---|---|
| 1 | homework · 30 pts · due **tomorrow** · ~1h | homework · 90 pts · due **in 4 days** · ~1h | **A** (30pt tomorrow) | Urgency beats points: due-tomorrow wins over 3× the points due 3 days later. |
| 2 | homework · 15 pts · due **tomorrow** · ~1h | homework · 200 pts · due **in 3 days** · ~1h | **A** (15pt tomorrow) | Urgency near-absolute when one item is imminent — a ~13× points gap doesn't flip a due-tomorrow item. |
| 3 | homework · 40 pts · due **in 3 days** · ~1h | homework · 180 pts · due **in 4 days** · ~1h | **B** (180pt in 4 days) | NOT pure-urgency: with nothing imminent, points win over a 1-day-sooner deadline. |
| 4 | homework · 20 pts · due **in 2 days** · ~1h | homework · 150 pts · due **in 4 days** · ~1h | **A** (20pt in 2 days) | 2 days is still imminent — small 2-day item beats a big 4-day item. Imminence cutoff ≈ ≤2 days. |

| 5 | **study** for exam · 100 pts · in **3 days** · ~2h | **do** assignment · 100 pts · due **in 3 days** · ~2h | **B** (do the assignment) | At equal points + horizon, concrete due work beats studying-ahead. Studying carries a deprioritization vs doing. |

| 6 | **study** for **200pt final** · in **3 days** · ~2h | **do** assignment · 30 pts · due **in 3 days** · ~2h | **A** (study 200pt final) | Big stakes flip it: a high-stakes exam's studying beats a small assignment at the same horizon. |
| 7 | **do** assignment · 30 pts · due **tomorrow** | **study** for exam · 100 pts · in **2 days** | **A — but CLOSE** | Genuine close call. Calvin: would flip to **studying** if the assignment were slightly smaller, OR if the test were more imminent (assignment due today vs test tomorrow → study the test). |
| 8 | **do** assignment · 25 pts · due **today** | **study** for exam · 100 pts · **tomorrow** | **B** (study the test) | Confirms Q7's hint: an imminent (tomorrow) high-stakes exam's studying outranks even a small *same-day* assignment. Studying tops out when the exam is both near AND high-stakes. |
| 9 | **overdue** assignment · 20 pts · due **2 days ago** (late OK) | upcoming assignment · 100 pts · due **in 3 days** | **A** (overdue first) | Recoverable overdue is caught up first, even when much smaller — overdue ≈ top urgency tier ("past-imminent"). Caveat: assumes late submission still earns credit. |
| 10 | assignment · 100 pts · due **in 3 days** · **~6h** (big) | assignment · 100 pts · due **in 3 days** · **~1h** (quick) | **B** (quick first) | At equal points + due, knock out the quick win first. Size alone does NOT raise priority — **opposite of current code** (which scores bigger=higher via the effort term). |
| 11 | **big** project · 80 pts · due **in 3 days** · ~10h (won't fit unless started now) | **quick** · 40 pts · due **tomorrow** · ~1h | **DEPENDS on late policy** | Forgiving late → quick first, turn big in a day late. No late credit → do the big one now (avoid the zero). Priority weighs **risk-of-loss = effort-that-won't-fit × cost-of-missing**. |
| 12 | **study** for **quiz** · 50 pts · in **2 days** | **study** for **exam** · 50 pts · in **2 days** | **B** (exam) | At equal points + timing, an exam outranks a quiz → assessment **type adds weight beyond points** (exam > quiz). |
| 13 | **discussion** post · 20 pts · in **2 days** · ~30m | **assignment** · 20 pts · in **2 days** · ~30m | **B** if forced, but really "do both" | Assignment edges it if forced, but a discussion is a **quick grab** — he'd spend 5 min on a low-effort response to bank the easy points. Discussions = cheap-ROI quick wins, not low priority. |
| 14 | study **cumulative final** · 100 pts · in **4 days** | study **regular unit exam** · 100 pts · in **4 days** | **A** (final) — unless grade leverage flips it | Final/cumulative outweighs a unit exam at equal points. NEW lever: he'd flip if his **current grade** in the final's class is already much better than in the other class. |
| 15 | assignment · 50 pts · in **3 days** · class where grade = **C** | assignment · 50 pts · in **3 days** · class where grade = **A** | **A** (the C class) | **Grade leverage confirmed**: work goes where the grade is most at risk; a locked-in A de-prioritizes that class. |
| 16 | **study** 100pt exam · in **3 days** · ~2h | **do** 50pt assignment · due **in 3 days** · ~2h | **A** (study) | Calibration: 100-study > 50-assignment → **study discount d > 0.5** (with Q5's d < 1 ⇒ d ∈ (0.5, 1)). Studying isn't heavily penalized at a 3-day horizon. |
| 17 | **study** 100pt exam · in **3 days** · ~2h | **do** 75pt assignment · due **in 3 days** · ~2h | **very close → depends on time budget** | ⭐ **REFRAME — the real objective: maximize TOTAL EXPECTED POINTS.** Skipping an assignment loses ALL its pts (0→75); studying only buys the *improvement over baseline* (~50/100 unstudied). Time-scarce: do assignment (+75) + bank ~50 on test = **125 > 100**. Priority ≈ **marginal points at stake per unit time**, not raw importance. The study discount d ≈ (1 − baseline-score-fraction). |
| 18 | study **shaky** exam · 100pt · 3d · ~50 cold | study **confident** exam · 100pt · 3d · ~90 cold | **A** (shaky) | Confirms marginal-value: study where the improvement is biggest (+50 vs +10). **Current class grade ≈ baseline proxy** → one Canvas signal sets BOTH the study-discount AND grade-leverage (low grade ⇒ high marginal study value + more at stake). |
| 19 | (design) unknown late-policy default | — | **No-late-credit default; else Gemini-from-syllabus** | Default: assume 0 late credit when unknown. But syllabi almost always state the policy (0 / flat 50% / −10%/day) → use **Gemini to parse the syllabus** (app already fetches it via `fetchSyllabus`) into a per-course late-penalty model feeding the marginal calc. |
| 20 | **study** 100pt exam · in **5 days** · ~2h | **do** 50pt assignment · due **in 3 days** · ~2h | **B** (do assignment) | Study **time-decay**: the same 100-study that BEAT a 50-assignment at a 3-day exam horizon (Q16) now LOSES when the exam is 5 days out. Studying ramps up steeply inside ~3–4 days; far exams (5+) wait their turn. |
| 21 | assignment · **50 pts** · in 3 days · class grade = **C** | assignment · **100 pts** · in 3 days · class grade = **A** | **A** (50pt C class) | **Grade-leverage is STRONG** — beats a 2× points gap. Implies points → *grade-utility weighted by ≈(1 − class grade)*. The same (1 − grade) factor unifies study-improvement (Q18) AND assignment-leverage ⇒ **current class grade is the master signal.** |
| 22 | assignment · 20 pts · **15 min** · in 3 days (high ROI) | assignment · 100 pts · **5 h** · in 3 days (5× pts) | **DEPENDS: do both fit? + late policy** | Confirms **two regimes**: both fit (slack) → quick-win/ROI first, then the big one; can't fit both (scarcity) → start the big one first to protect its deadline (less so if late is forgiving). **Time budget gates the regime** → keep the scheduler for fitting + the marginal scorer for ranking. |
| 23 | assignment · 50 pts · **no due date** · ~1h | assignment · 50 pts · due **in 4 days** · ~1h | **B** (dated first); undated = backfill | Undated = **backfill into slack**: only prioritize a no-deadline item once the dated queue has a **≥5-day opening** before the next deadline. Ranks below anything dated within ~5 days; surfaced when there's clear runway. (Refines current hard-sink.) |
| 24 | assignment · 20 pts · due **today** | assignment · 80 pts · due **tomorrow** | **Scarcity → 80pt; slack → 20pt-today first** | Two regimes again, inside the imminent tier: only-time-for-one (scarcity) → take the bigger points (80); time-for-both (slack) → soonest-due first (20pt today) so BOTH make their deadlines. **slack = EDF; scarcity = max expected-points (drop the smallest).** |
| 25 | study **50pt exam** · in 2 days | study **80pt quiz** · in 2 days (60% more pts) | **A** (exam) | ⭐ **Reframes "points": the signal is grade-WEIGHT (% of class grade), not raw points.** Calvin picked the exam because it's implied to be a bigger share of its class grade than the quiz is of its. Exams > quizzes because they're a bigger grade-fraction. Use Canvas group-weights / points-of-total; **type is a fallback proxy** for grade-weight. |

## Running inferences
- **Model is imminence-gated, not "earliest-due-always":**
  - **Imminent = due within ~2 days** → hard priority tier; beats even ~13× the points (Q1, Q2, Q4).
  - **Non-imminent (3+ days)** → ordered by **points (impact)**, not small due-date gaps (Q3).
- **Studying competes in the points tier with a handicap vs doing** (Q5, Q6): at equal horizon, exam-study ≈ its points × ~0.5–0.7 (100-study lost to 100-assignment; 200-study beat 30-assignment).
- **The study↔do boundary is SMOOTH/close, not a hard tier** (Q7): 30pt-assign-tomorrow barely edges 100pt-exam-study-in-2d, and small nudges flip it. **Studying rises sharply as the exam nears** — an imminent test can pull studying above a same-day small assignment (Q8 confirms). → favors a continuous score with a study term that scales up with exam imminence.
- Still to probe: quiz vs exam, project, discussion, effort/workload, overdue, cumulative/midterm-vs-final; imminent-tier internal tiebreak.

## Synthesized model (draft v1) — from Q1–Q15

Order all active work like this:

1. **Recoverable overdue → top.** Catch up first, even when small (Q9). *Only if late work still earns credit (don't surface dead-zero items).*
2. **Imminent → next, soonest-first.** "Effective deadline within ~2 days" (Q1,Q2,Q4). An **imminent + high-stakes exam's studying** belongs here too — it climbs to the top as the test nears (Q7,Q8).
3. **Everything else → by a stakes score:**
   - base = **points** (Q3 — points lead once nothing's imminent)
   - × **type weight**: final/cumulative > exam > quiz > assignment ≈ discussion (Q12,Q14 — type adds weight beyond points)
   - × **grade leverage**: ↑ classes where the current grade is at risk, ↓ a locked-in A (Q14,Q15)
   - **studying** counts at a **discount vs doing** (~0.5–0.7× points) that **shrinks as the exam nears** (Q5,Q6,Q7,Q8)
   - **quick-win bump**: low-effort items get done fast for the ROI — effort is **inverse** (less effort → higher), the OPPOSITE of today's code (Q10,Q13)
   - **risk-of-loss**: a big task that won't fit before its deadline rises, scaled by how harsh the late policy is (Q11)

**Data-dependent factors (need fetching / a default):**
- **Current class grade** — Canvas exposes it (enrollment current_score); enables grade leverage. App may not fetch it yet.
- **Late policy** — Canvas usually does NOT expose it; risk-of-loss harshness needs a default or a per-course setting.

**Biggest departures from current `lib/priority.ts`:** imminence is a ~2-day threshold (not 7-day linear); points lead among non-imminent (not 40% urgency); **type matters** (currently ignored); **effort is inverse / quick-wins** (current code rewards bigger); **studying, grade-leverage, late-policy** are new.

**Still fuzzy (would sharpen with a few more Qs):** exact imminence cutoff (1 vs 2 vs 3 days, hard vs smooth); within-imminent tiebreak (today vs tomorrow); the study-discount magnitude + how fast it rises; the type-weight multipliers; grade-leverage strength.

## Consolidated model (post-Q17 reframe) — "Expected-Points Maximizer"

Q17 reframed the whole thing: the draft v1 weighted score was approximating a deeper objective.

**Objective:** order work to maximize the student's **total expected points (grade) per unit time**, within their daily study budget. A task's priority = the **marginal expected points it puts at stake right now** (more at stake → do sooner).

- **Assignment** → `points × fraction-at-risk-now`. Fraction-at-risk = how much you'd lose by *not* doing it now = f(due proximity, late penalty). No-late-credit (default) ⇒ a due-soon assignment risks its full points (high). A −10%/day policy ⇒ deferring a day costs ~10% (lower urgency). Unsubmitted = 0, so an assignment's ceiling is its full points.
- **Studying (exam/quiz)** → `points × expected-improvement`, where improvement ≈ `1 − baseline` and **baseline ≈ current class grade**. Rises as the exam nears (improvement gets less recoverable). Exam > quiz; cumulative/final highest (most material at stake).
- **Quick wins** (discussions, short tasks) → high **marginal-points-per-hour** → surface early (cheap points; Q10, Q13). Effort is INVERSE of the current code.
- **Overdue (recoverable)** → recover the still-capturable (late-penalized) points → top; drop truly 0-credit dead items.

**Three signals carry most of the model:**
- **Grade-weight, not raw points** (Q25) → an item's impact = its **% of the class grade** (Canvas assignment-group weights / points-of-total), so raw points across classes aren't comparable. **Type (exam/quiz/discussion) is a fallback proxy** for grade-weight when the exact weight isn't available.
- **Current class grade** (Canvas exposes per-course score) → sets the study **baseline** AND **grade-leverage** in one (low grade ⇒ studying helps more AND more at stake).
- **Late policy** → default *no late credit*; otherwise **Gemini parses the syllabus** (already fetched) into a per-course penalty (0 / flat-% / %-per-day).

**Inputs:** points ✓, effort/time est ✓ (AI), due date ✓, type ✓ — plus NEW per-course **current grade** (fetch from Canvas) and **late policy** (Gemini-from-syllabus). Baseline ≈ class grade.

**vs current `lib/priority.ts`:** replaces the 40/25/25/10 heuristic (ignores type, rewards bigger-effort, never uses grade/late/baseline) with a principled marginal-points calc that self-calibrates from real inputs — far fewer magic numbers.

**Two regimes (confirmed Q22, Q24) — the same marginal values drive both:**
- **Slack (everything fits):** sequence by **deadline (EDF)** so every deadline is met; quick-wins / ROI break ties (do the due-today 20pt before the due-tomorrow 80pt). → the scheduler's job.
- **Scarcity (can't fit all):** **sacrifice the lowest marginal-expected-points** items, protect the highest (only time for one → do the 80pt, let the 20pt go late). → the ranker's job.
- So "priority" = **marginal expected points (per hour)** — used to RANK in slack and to CHOOSE-WHAT-TO-DROP under scarcity; the scheduler enforces feasibility/EDF.

**Build notes (when encoding):** keep the EDF scheduler (`generatePlan`) for time-fitting; replace the priority *scorer* with the marginal calc; add a Canvas current-grade fetch + a Gemini syllabus→late-policy step (cache per course); make overdue conditional on recoverability; treat undated items as backfill (surface only when the next deadline is ≥5 days out).

## Validation scenarios

### Scenario A — typical Tuesday · 8 items · Bio (C) / Calc (B) / History (A) — ✅ PASSED
Model order: **a** Bio disc (quick grab, due tmrw) → **b** Calc PS (due tmrw) → **c** Bio midterm study (3d, 25%, C) → **d** History essay (100pt but locked-A) → **g** Bio lab (60pt, 5d, C) → **f** Calc quiz study (2d, 5%) → **e** History overdue quiz → **h** undated. Calvin confirmed all four gut-checks:
- **Overdue is MARGINAL, not absolute** — the small, forgiving-late, locked-A overdue quiz *correctly* sinks to #7. Resolves the Q9 "overdue first" tension: overdue floats up only when points/leverage justify it.
- **a before b in slack** (quick-win first); Calvin notes it **flips under scarcity** ("if I can't do both, the bigger pt total matters") — reconfirms two-regime.
- **Leverage beats raw points** (C-class midterm study > 100pt A-class essay). ✓
- **Far high-leverage > sooner low-weight** (60pt Bio lab, C, 5d > 5%-weight Calc quiz, 2d). ✓

### Scenario B — crunch night (scarcity) · 5 items · ~3h available — ✅ PASSED
Model: protect Calc exam study (~30%, tomorrow, unrecoverable) + Bio hw (C, no-late-credit, full 30 at risk) + a 10-min Calc-disc grab; **DEFER the 80pt History essay** (A-class + −10%/day ⇒ 1 day late ≈ −8 pts in a class locked at 94%). Calvin confirmed every call, including deferring the single biggest-point item.
- ⭐ **REFINEMENT — partial allocation / kill catastrophic zeros:** Calvin: *"if there were no late credit for History I'd dedicate a little time to it from the study block."* So under scarcity, a high-value item facing **total loss** (no late credit) is NOT fully dropped even when outranked — time is **split** to avoid the 80→0. Implies **diminishing returns** (2nd study hour < 1st essay hour) ⇒ optimal allocation **equalizes marginal-points-per-hour** across items, not strict one-at-a-time. The scheduler's weighted-slack split already models this *if the weights are marginal-pts/hr*.

### Scenario C — light week (slack / get-ahead) · 6 items — ✅ PASSED (with refinement)
Model "get ahead" order: f Calc disc (grab) → a Bio midterm study (4d, 25%, C, ramp edge) → d Bio essay (C) → c Calc project (B) → b History final study → e undated reading. Calvin confirmed the bold call: **park the 30% History final** (locked-A + 6 days out ⇒ ~0 marginal now) and grind the at-risk Bio midterm instead.
- ⭐ **REFINEMENT — undated is MARGINAL too, not hard-bottom:** Calvin: *"put the reading above studying for the final for now, but if it stays uncompleted until the study ramp begins it reverts to the bottom."* The undated reading (20 real capturable pts, decent ROI) **outranks near-zero-marginal work** (studying a locked-A final 6 days out) during slack, then drops once the final's ramp begins. Undated ISN'T auto-last — rank it by marginal value (real points, low urgency) like everything else. Marginal values are **time-dependent** → recompute each day (app already does) and the override self-corrects.

### ⭐ Unifying result of validation (A + B + C)
All three refinements point one way: **there are NO hard tiers — everything ranks by marginal expected-points-per-hour, with diminishing returns.**
- Overdue is NOT auto-top (A) — a small, forgiving-late, locked-A overdue item sinks.
- Undated is NOT auto-bottom (C) — real bankable points beat near-zero-marginal study during slack.
- Scarcity SPLITS time (B) — diminishing returns push hours toward killing catastrophic zeros, not toward over-investing the #1.
The apparent "overdue-first / imminent / undated-last" tiers all **fall out of** the single marginal calc and self-correct at the edges. The model is ONE objective (maximize expected grade per hour, time-dependent, recomputed daily), not a stack of rules — which makes the build simpler, not harder.
- Still to calibrate: grade-leverage strength (Q21), type multipliers (exam/quiz), ROI / per-hour vs absolute, imminence-cutoff sharpness, **undated-item placement** (no due date → where does it rank?).
