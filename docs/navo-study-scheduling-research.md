# Optimal Learning & Study Habits — Research Synthesis for Navo's Scheduler

**Purpose.** The prioritizer answers *what to work on first*. This document grounds the next question — *when and how to schedule it* — in the learning-science literature, and translates the evidence into concrete, encodable scheduling rules.

**Evidence tiers used throughout:**
- **[STRONG]** — robust, replicated, large effects. Encode as near-constraints/defaults.
- **[MODERATE]** — real but smaller/inconsistent. Encode as smart, user-adjustable defaults.
- **[MYTH/WEAK]** — popular but unsupported. Do **not** build on these.

---

## Part 1 — The five highest-confidence pillars

These five carry the most weight and should anchor the scheduler's design.

1. **Space it, don't mass it.** [STRONG] Distributed practice beat massed (cramming) in ~96% of comparisons across 317 experiments (Cepeda et al., 2006). Correct spacing roughly **doubles** long-term retention at month-plus horizons (Cepeda et al., 2008).
2. **Test, don't reread.** [STRONG] Retrieval practice (self-testing) beats restudying with **g ≈ 0.61** (Adesope et al., 2017). Re-reading and highlighting are **low-utility** (Dunlosky et al., 2013).
3. **Protect sleep above everything.** [STRONG] Sleep consolidates memory; losing it harms encoding (~40% worse), consolidation, and test-day performance (≈0.10% BAC impairment after ~24h awake). All-nighters sabotage learning on every axis at once.
4. **Bounded, single-task blocks + real breaks.** [STRONG mechanism] Sustained attention decays with time-on-task; brief breaks prevent the decline; multitasking/device use lowers retention for the user *and* nearby peers.
5. **Start early via decomposed, cue-bound sub-goals.** [STRONG] 80–95% of students procrastinate (Steel, 2007); they under-estimate task time by ~64% (the planning fallacy; Buehler et al., 1994). If-then plans (d ≈ 0.65) and imposed, evenly-spaced sub-deadlines are the antidotes.

**The unifying theme:** the highest-value techniques (spacing, retrieval, interleaving) are **"desirable difficulties"** (Bjork) — they feel *harder and less productive in the moment* but produce far better durable learning. Students reliably mistake the *fluency* of cramming/re-reading for learning, so **a scheduler that defaults to the hard-but-effective methods adds value the student won't request on their own.**

---

## Part 2 — The evidence by theme

### A. Distributed practice (spacing) [STRONG]
- Spaced > massed in **259/271 comparisons** (Cepeda et al., 2006, *Psych Bulletin*; 839 assessments). Average effect d ≈ 0.46 (Donovan & Radosevich, 1999).
- **Optimal gap is a function of the retention interval (time-to-test):** roughly **10–20% of it**, and the proportion *shrinks* as the horizon lengthens (Cepeda et al., 2008, *Psych Science*). Anchor: a 70-day horizon → optimal gap ~21 days.
- **The peak is broad and flat, and the asymmetry matters:** *under*-spacing (cramming) is far more costly than *over*-spacing. When uncertain, **err toward a longer gap.**
- **Expanding vs. equal intervals: overstated** [WEAK]. Equal spacing is as good or better at long delays (Karpicke & Roediger, 2007). What carries the effect is *spacing at all* + *successful retrieval each time* — not the expansion geometry.
- Diminishing returns past ~5 sessions on the same material.

### B. Retrieval practice + successive relearning [STRONG]
- **g ≈ 0.61** overall; **≈ 0.51 vs. restudy** (Adesope et al., 2017). Benefit is **larger after a delay** — the testing/restudy crossover (Roediger & Karpicke, 2006: at 1 week, tested 56% vs. restudy 42%).
- **Successive relearning** (retrieve to a criterion, repeated across spaced sessions) is the template for "study for the exam": retention rose from ~56% (2 sessions) to ~83% (5 sessions) at a 30-day test, and it raised real course-exam grades (Rawson et al., 2013; Janes et al., 2020).
- **Feedback is required for hard material** (prevents error persistence); a short *delay* before revealing answers is fine or better (Butler et al., 2008).
- Retrieval **also fixes metacognition**: students are overconfident and misled by fluency; testing gives objective signal (Karpicke & Roediger, 2008).

### C. Interleaving — *similarity matters* [STRONG but moderated]
- Overall **g ≈ 0.42** (Brunmair & Richter, 2019, 59 studies), but the spread is the story:
  - **Math problem-type discrimination:** real benefit (d up to 0.83 in classroom RCTs; Rohrer et al., 2020). Mixing problem types forces the student to *identify which method applies* — the hardest part of a test.
  - **Confusable visual/conceptual categories:** strong (paintings g = 0.67).
  - **Arbitrary vocabulary / paired-associates:** interleaving is **negative (g = −0.39)** — block these.
- Interleave **related, confusable** material; **block distinct** topics and rote pairs. Interleaving auto-spaces, so it delivers a spacing bonus for free.

### D. Session length, attention & breaks
- **There is no magic block length** [MYTH-bust]. "10–15 min attention span," "8-second span," and "study exactly 25/45/90 min" are **folklore** (Wilson & Korn, 2007; the goldfish stat is fabricated; the 90-min ultradian rule is a loose 80–120 min, weak as a prescription).
- **What's real** [STRONG]: a vigilance decrement / rising mind-wandering with time-on-task (retention drops in the back half of long sessions; Risko et al., 2013), and **brief breaks prevent the decline** (Ariga & Lleras, 2011). So: *bounded blocks + breaks*, not a specific magic number.
- **Breaks** [MODERATE→STRONG]: micro-breaks restore vigor/energy (d ≈ 0.35) but **5 min is too short to restore performance on hard work** — use longer breaks (15–30 min) after demanding blocks (Albulescu et al., 2022). **"Wakeful rest"** (quiet downtime) after learning aids consolidation (g ≈ 0.45). **Break content matters:** a walk/nature restores attention; **phone/social-media breaks give ~zero cognitive recovery** (Kang & Kurtzberg, 2019).
- **Pomodoro** [structure STRONG, the numbers MYTH]: its value is *scheduled breaks + single-tasking + a self-imposed deadline*, not the specific 25/5. The direct test found scheduled > self-paced breaks for mood/focus, but **no difference in output** (Biwer et al., 2023) — the benefit is removing the *decision* of when to break.

### E. Cognitive load [STRONG]
- Working memory holds only **~4 novel chunks** (Cowan, 2010). New, high-"element-interactivity" material overloads it and blocks schema-building — the mechanistic case against dense cramming of hard new content.
- **Worked examples** beat solving for novices (faster, better transfer; ~d 0.55–0.70 in STEM), then **fade** guidance as expertise grows (expertise-reversal effect; Kalyuga et al., 2003).
- **Sequence simple → complex**; cap the amount of genuinely-*new* interacting material per session. Practice of already-learned material can be denser/longer.

### F. Sleep & memory consolidation [STRONG]
- Sleep consolidates declarative (SWS, early night) and procedural/emotional (REM, late night) memory (Diekelmann & Born, 2010). Truncated nights disproportionately strip REM.
- **Sleep deprivation harms three stages:** encoding *before* study (~40% worse, Yoo et al., 2007), consolidation *after* study (more forgetting), and retrieval *at test* (≈0.10% BAC impairment, more false memories). **All-nighters hit all three at once.**
- **Study-then-sleep helps** (strongest for skills/recent material); **spread study across days so each is followed by a night's sleep**, and keep the **night before an exam a sleep night, not a study night**.

### G. Circadian rhythm & time-of-day [MODERATE]
- Teens/young adults are biologically **phase-delayed (evening types)**, peaking latest ~age 19–20 — *physiology, not laziness* (Roenneberg et al., 2004). This is why early start times cause chronic sleep loss (AAP/AASM recommend ≥8:30am; later starts → +34 min sleep, +4.5% grades; Dunster et al., 2018).
- **Synchrony effect** (perform best at your chronotype's peak) is real but **modest and inconsistent** (~45% of studies). Treat chronotype as a *soft* personalization signal.
- Near-universal **post-lunch dip (~1–3pm)** — good for light review or a nap.
- **Naps:** 10–20 min for a quick alertness boost (minimal grogginess); ~90 min (full cycle) for memory/skill consolidation; **avoid naps after ~4pm** (they erode night sleep).

### H. Exercise, nutrition, caffeine [MODERATE]
- A single light-moderate exercise bout gives a small acute cognitive lift (g ≈ 0.13). Fitness correlates with academic/executive function.
- Don't study/test hungry or dehydrated (mild dehydration degrades attention). **Caffeine** helps alertness but **cut it off ~6h before sleep** (400mg even 6h pre-bed cut sleep ~41 min; Drake et al., 2013) — never to fuel an all-nighter.

### I. Motivation, self-regulation & procrastination
- **Self-regulated learning** (Zimmerman): *forethought (plan/goal) → performance (do/monitor) → reflection (review) →* repeat. Metacognitive/self-regulation strategies are high-impact (~d 0.69 in Hattie). The app's loop maps onto this directly.
- **Goals:** specific + **proximal** beat vague + distal; a distant goal alone is *no better than no goal* (Bandura & Schunk, 1981). Convert big/distant goals into near-term sub-goals.
- **Implementation intentions (if-then plans):** **d ≈ 0.65** (Gollwitzer & Sheeran, 2006). *"When [cue], I will [task] at [place]"* delegates initiation to environmental cues. Strongest lever that's directly buildable. (Wrap in mental-contrasting = MCII for the best academic evidence.)
- **Procrastination** (Steel, 2007): 80–95% of students; driven by **impulsiveness + low self-control + task aversiveness**, not anxiety. **Temporal Motivation Theory:** motivation = (Expectancy × Value) / (Impulsiveness × Delay) — distant deadlines kill present motivation. **Imposed, evenly-spaced deadlines beat self-set beat a single end-deadline** (Ariely & Wertenbroch, 2002).
- **Planning fallacy** [STRONG]: students underestimate their own task time — best guesses ran ~64% short of actual, missing even the worst-case (Buehler et al., 1994). **Unpacking a task reduces the error** (Kruger & Evans, 2004).
- **Habits** [MODERATE]: cue-stable context, not willpower; median **~66 days** to automaticity (range 18–254) — the "21 days" is a myth — and **missing one day doesn't break a habit** (Lally et al., 2010). → forgiving streaks.
- **Self-Determination Theory:** support autonomy, competence, relatedness. **Tangible contingent rewards undermine intrinsic motivation** (d ≈ −0.3 to −0.4; Deci et al., 1999) — prefer **informational** feedback ("you recalled 18/20") over controlling gamification.

### J. High school vs. college [MODERATE]
- The **prefrontal cortex (planning/impulse control) matures into the mid-20s**; reward-seeking peaks early (~19) while self-regulation plateaus only ~23–26 (Steinberg, 2008). → younger users need *more* external scaffolding.
- **The environment flips:** HS = high structure, frequent low-stakes work, short deadlines. College = unstructured time, fewer high-stakes assessments, distant deadlines — *exactly* the condition that maximizes procrastination. **The app should replace the structure that high school provides and college removes.**

---

## Part 3 — The unified scheduling model (the actionable bridge)

Concrete rules, organized by the scheduler's real decisions. **[heuristic]** marks a sensible design choice rather than a measured constant.

### 1. Expand each assessment into a spaced sequence (don't schedule one "study" block)
Reverse-plan from the due/exam date; target gaps ≈ 10–20% of the time-to-test, biased longer; cap ~5–6 sessions; final light review the day before:

| Days until exam | Gap between sessions | # sessions [heuristic] |
|---|---|---|
| 2–3 | ~1 day (salvage mode) | 2–3 |
| ~7 | ~1–2 days | 3–4 (e.g. −7, −5, −3, −1) |
| ~14 | ~2–3 days | 4–5 |
| ~30 | ~4–7 days | 4–5 |
| cumulative final (~10 wk) | ~1–3 wk, tightening | 5–6 |

Start the first session **as soon as the material is taught / the assignment opens**, not N days before the deadline.

### 2. Make every session a retrieval session (successive relearning loop)
- Session 1: encode, then **self-test to ~3 correct retrievals** per key item (flashcards, practice problems, blank-paper "brain dump" — not re-copying notes).
- Sessions 2…N: **open by retrieving last session's material** (1 correct each), then extend. Always give corrective feedback (a short delay before the answer is fine).
- **Measure progress in items recalled, not minutes**, and **gate on objective recall, not "I feel like I know it"** (students are overconfident).
- Calibrate to ~85% success [heuristic]: too easy → lengthen gaps/advance; failing most → shorten gaps + add an encoding pass.

### 3. Interleave selectively
- **Interleave** confusable, strategy-choice material **within a subject** (math/physics/chem/stats problem types; categorization) — mix 3–5 related types so the student must first *identify* the type. Build **cumulative** sessions that fold in prior topics.
- **Block** distinct topics and rote vocabulary (interleaving *hurts* pairs).
- Allow an initial blocked exposure to a brand-new concept, *then* interleave.

### 4. Block length & structure
- **Default block ~25–50 min** (≈45 as a single default), **user-adjustable (20–90)**. Never market a number as "scientifically optimal." [heuristic from the evidence that it's bounded-blocks-plus-breaks that matters]
- **Vary by task** (the smart part): **new/hard conceptual material → shorter blocks, limited new scope** (cognitive-load cap, favor worked examples); **review/practice of known material → longer blocks OK**; **deep-focus/flow work → allow longer, let the user defer the break.**
- **One subject per block**, switching only at break boundaries (avoid mid-block switching → switch costs + attention residue).
- **Breaks:** short (5–10 min) between blocks; **longer (15–30 min) after demanding blocks / every ~2–4 blocks.** Nudge **walk/rest/outdoors, discourage phone scrolling.** Optionally a ~10-min quiet "wakeful rest" after a heavy learning session.
- **Chunk large tasks across days** at coherent sub-goal boundaries (not one marathon, not mid-thought cuts).

### 5. Time-of-day & sleep (the non-negotiables)
- **Protected sleep window** (HS 8–10h, college 7–9h) — **never schedule study inside it**; **hard study cutoff** ~60–90 min before bedtime.
- **Refuse all-nighters by default** and offer "sleep + morning review" instead.
- **Spread study across days so each is followed by sleep; the night before an exam is a sleep night**, not a cram night.
- **Place demanding new learning in the user's peak-alertness window** (for evening-type teens: late morning → early evening; avoid the post-lunch dip and late night); **light review in low-energy slots.**
- **Short pre-bed review** (~15–30 min) of *that day's* material for consolidation — recent/procedural content, not heavy new material.
- **Exam morning:** sleep already banked → light breakfast + hydration → brief low-stakes warm-up (not new cramming) → optional short walk + caffeine timed to peak at start.

### 6. Counter procrastination & the planning fallacy (start-early engine)
- **Auto-decompose** distant/large tasks into proximal sub-tasks with their own near-term sub-deadlines; **impose evenly-spaced** sub-deadlines (don't make spacing optional).
- **Front-load** the plan (buffer earlier); make the first step trivially easy ("just 10 min / one problem").
- **Generate an if-then plan per block:** *"When I finish dinner at 6:30, I'll do the chem set at the kitchen table"* (d ≈ 0.65). Optionally a one-line mental-contrast + commitment tap (MCII).
- **Inflate time estimates:** schedule against an inflated estimate, and learn each user's personal estimate-vs-actual multiplier over time; add explicit **buffer/catch-up blocks.** *(This directly upgrades the app's existing AI effort estimates.)*
- **Anchor blocks to stable cues** (same time/place / after an existing routine); set habit expectations to **~2 months**; make **streaks forgiving** (one miss ≠ reset).

### 7. High-school vs. college defaults
| | High school | College |
|---|---|---|
| Scaffolding | High; pre-fill a daily schedule; shorter blocks | Lighter; help convert unstructured time into blocks |
| Sub-deadlines | Frequent, short, recurring | Aggressively decompose distant high-stakes deliverables |
| Nudges | More frequent/directive | Fewer, autonomy-respecting; self-monitoring dashboards |
| Planning-fallacy multiplier | Larger default (less estimating experience) | Personalized from their history |
| Autonomy | Choices within guardrails | Maximize user control |

### 8. UX honesty (so the science isn't undone by feelings)
- **Default to spacing/interleaving/retrieval rather than asking** — students under-choose them.
- **Warn that these will feel harder / "less productive"** in the moment, and that the difficulty *is* the mechanism.
- **Show progress as delayed retrieval performance, not in-session comfort.**

---

## Part 4 — Myths to NOT build on (the researchers flagged these explicitly)

- **Learning styles** — refuted; >90% of teachers still believe it. Never tailor content to a "learner type."
- **"21 days to a habit"** — myth (median ~66 days).
- **"8-second attention span" / "attention drops after 10–15 min"** — fabricated / debunked.
- **"Study exactly 25 / 45 / 90 minutes"** — arbitrary; no validated magic length.
- **Expanding > equal spacing intervals** — overstated; equal is as good or better long-term.
- **Growth mindset as a broad lever** — effects small (d ≈ 0.08), mostly for at-risk students under supportive norms. Light touch only.
- **Zeigarnik effect** (interrupting to aid memory) — largely fails to replicate.
- **"Multitasking costs 40% of your time"** — a popular extrapolation, not a measured result (though multitasking *does* hurt retention — that part is real).

---

## Part 5 — How this maps onto Navo's current scheduler

The existing `lib/scheduler.ts` (EDF deadline-fitting + importance-weighted slack + `studyLeadDays` for exams/quizzes) is a solid base. The research suggests these upgrades:
- **Replace "study lead days" with the spaced-sequence templates** (Part 3.1) — generate N retrieval sessions on specific days, not a continuous lead-up block.
- **Tag each study block as a successive-relearning session** (retrieve-prior → extend) rather than generic "study."
- **Add session-length logic by task type/difficulty** + break insertion (Part 3.4).
- **Add a sleep-protection layer** (hard study cutoff, no all-nighters, night-before-exam = sleep) and **time-of-day placement** by chronotype (Part 3.5).
- **Upgrade the AI effort estimate with a planning-fallacy multiplier** and per-user calibration (Part 3.6) — this also feeds the prioritizer's effort term.
- **Layer if-then plan generation + forgiving habit/streak mechanics** on top (Part 3.6).

---

## Key sources (meta-analyses & foundational primary studies)
Cepeda et al. 2006 (*Psych Bulletin*) & 2008 (*Psych Science*) — spacing. Adesope et al. 2017 (*RER*) & Roediger & Karpicke 2006 (*Psych Science*) — retrieval. Rawson et al. 2013 — successive relearning. Brunmair & Richter 2019 (*Psych Bulletin*) & Rohrer et al. 2020 (*JEP*) — interleaving. Dunlosky et al. 2013 (*PSPI*) — technique utility ranking. Bjork & Bjork 2011 — desirable difficulties. Albulescu et al. 2022 (*PLOS ONE*) — breaks; Dewar et al. 2012/2014 — wakeful rest; Kang & Kurtzberg 2019 — phone breaks; Biwer et al. 2023 — Pomodoro. Cowan 2010 + Sweller (CLT); Kalyuga et al. 2003 — expertise reversal. Diekelmann & Born 2010; Yoo et al. 2007; Walker — sleep. AAP 2014 / AASM 2017; Dunster et al. 2018 — circadian/start times. Gollwitzer & Sheeran 2006 — if-then plans; Steel 2007 (*Psych Bulletin*) — procrastination/TMT; Buehler et al. 1994 — planning fallacy; Lally et al. 2010 — habits; Deci/Koestner/Ryan 1999, Ryan & Deci 2000 — SDT; Steinberg 2008 — adolescent development. Pashler et al. 2008 — learning-styles myth; Sisk et al. 2018 — growth-mindset meta-analysis.

*(Full per-claim citations with effect sizes are preserved in the four source research briefs that fed this synthesis.)*
