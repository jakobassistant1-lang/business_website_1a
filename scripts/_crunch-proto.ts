// CRUNCH-AWARE prioritizer PROTOTYPE v2 on the real sandbox data (NO lib/ edits).
// Incorporates Calvin's rulings (2026-07-21):
//   C1  capacity counts TODAY: hours available for a deadline d days out = H·(d+1)
//   C2  crunch ramp starts at 80% load (unchanged)
//   C3  far-out items may NEVER outrank nearer work via crunch → slot-stable window
//       reorder: the slack ranking (p=0.15) is the permanent skeleton; under crunch,
//       ONLY items due within WINDOW days reorder among themselves by crunch value,
//       inside the exact slots they already occupied. Far/undated/dead never move.
//       (Also kills the far-pair churn and the undated-churn findings by construction,
//       and sidesteps the fractional-weight cross-exponent pathology: values are never
//       compared across the window boundary.)
//   #4  horizon fade: a deadline's load counts fully at ≤7d, fades linearly to 0 by 21d
//       (no overnight mode lurch when a far pile crosses a hard horizon).
//   #5  (provisional — not yet formally approved) study demand spreads across the
//       study-lead window before the exam (quiz 3d / exam 7d / final 14d, per-user),
//       so a big final's hours press on THIS week and exam-day no longer takes the
//       whole estimate in one lump.
//   value = leverage · weight^p · capture;  p = 0.15 + 0.60·clamp((ρ−0.8)/0.7)
// Run: NODE_ENV=development npx tsx --env-file=.env scripts/_crunch-proto.ts [H ...] [--date=YYYY-MM-DD]
import { prisma } from "../lib/prisma";
import { effectiveEffort } from "../lib/calendarData";
import { courseTotalPoints, rankActiveRows, type RankableRow } from "../lib/rankActive";
import { resolveWeight } from "../lib/gradeWeight";
import { itemType, isStudyType, requiresOnlineSubmission } from "../lib/itemType";
import { assessmentTier } from "../lib/studyPlan";
import { leverage, LAMBDA, OVERDUE_FRACTION, DEFAULT_STUDY_BASELINE } from "../lib/marginalPriority";
import { DEFAULT_LATE_POLICY, coerceLatePolicy, salvageFraction, slipLoss, type LatePolicy } from "../lib/latePolicy";

const USER = 5;
const P_SLACK = 0.15, P_CRUNCH = 0.75, RAMP_LO = 0.8, RAMP_HI = 1.5;
const WINDOW = 14;      // crunch may reorder only items due within this many days
const FADE_FULL = 7;    // loads at deadlines ≤7d count fully toward ρ…
const FADE_ZERO = 21;   // …fading linearly to zero weight by 21d
const HYBRID: [number, number][] = [[0, 1], [1, 0.64], [2, 0.42], [3, 0.28], [4, 0.19], [5, 0.155], [6, 0.13], [7, 0.11], [9, 0.085], [11, 0.067], [14, 0.048], [18, 0.032], [24, 0.016], [32, 0.007], [45, 0]];
const STUDY_V2: [number, number][] = [[0, 1], [1, 1], [2, 0.85], [3, 0.55], [5, 0.34], [7, 0.24], [10, 0.14], [14, 0.07], [21, 0.03], [30, 0.012], [45, 0]];

function lerp(c: [number, number][], x: number): number {
  if (x <= c[0][0]) return c[0][1];
  const last = c[c.length - 1]; if (x >= last[0]) return last[1];
  for (let i = 1; i < c.length; i++) { const [x0, y0] = c[i - 1], [x1, y1] = c[i]; if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); }
  return last[1];
}
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const DAY = 86_400_000;
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const daysUntil = (due: Date | null, now: Date) => (due ? Math.round((startOfDay(due).getTime() - startOfDay(now).getTime()) / DAY) : null);

interface PItem {
  canvasId: number; name: string; courseName: string; d: number | null;
  weight: number; grade: number | null; lp: LatePolicy; effort: number;
  isStudy: boolean; lead: number; points: number | null; type: string;
}

function captureOf(it: PItem): number {
  if (it.isStudy) {
    if (it.d === null || it.d < 0) return 0;
    return clamp01(1 - (it.grade ?? DEFAULT_STUDY_BASELINE)) * lerp(STUDY_V2, it.d);
  }
  if (it.d === null) return LAMBDA;
  if (it.d < 0) return salvageFraction(it.lp, -it.d) * OVERDUE_FRACTION;
  return LAMBDA + (1 - LAMBDA) * lerp(HYBRID, it.d) * slipLoss(it.lp);
}

export function rankScenario(items: PItem[], H: number) {
  // demand map: hours landing per day (C1 buckets at the true day, incl. day 0).
  // Overdue: only STILL-BLEEDING (perday) items press on the schedule, scaled by
  // remaining salvage — flat/none overdue has no marginal time pressure, and the
  // perday contribution decays smoothly to 0 as credit bleeds out (no mode lurch).
  const dl = new Map<number, number>();
  for (const it of items) {
    if (it.d === null) continue;
    if (it.d < 0) {
      if (!it.isStudy && it.lp.kind === "perday") {
        const s = salvageFraction(it.lp, -it.d);
        if (s > 0) dl.set(0, (dl.get(0) ?? 0) + it.effort * s);
      }
      continue;
    }
    if (it.isStudy) {
      const S = Math.max(1, Math.min(it.lead, it.d) + 1); // spread over the lead window (#5); clamp guards bad lead values
      for (let k = 0; k < S; k++) { const day = it.d - k; dl.set(day, (dl.get(day) ?? 0) + it.effort / S); }
    } else {
      dl.set(it.d, (dl.get(it.d) ?? 0) + it.effort);
    }
  }
  // prefix loads with C1 capacity H·(d+1); ρ = max of fade(d)·L(d).
  // span = the furthest congested day (eff ≥ RAMP_LO) within WINDOW: crunch may
  // only triage items due inside the actually-contested span, so a one-night
  // spike (d*=1) cannot reshuffle items due 9–13 days out and snap back tomorrow.
  const profile: { d: number; load: number; eff: number }[] = [];
  let cum = 0, rho = 0, dstar = 0, span = 0;
  for (const d of [...dl.keys()].sort((a, b) => a - b)) {
    cum += dl.get(d)!;
    const load = cum / (H * (d + 1));
    const fade = d <= FADE_FULL ? 1 : Math.max(0, (FADE_ZERO - d) / (FADE_ZERO - FADE_FULL));
    const eff = load * fade;
    profile.push({ d, load, eff });
    if (eff > rho) { rho = eff; dstar = d; }
    if (eff >= RAMP_LO && d <= WINDOW) span = Math.max(span, d);
  }
  const p = P_SLACK + (P_CRUNCH - P_SLACK) * clamp01((rho - RAMP_LO) / (RAMP_HI - RAMP_LO));

  // slack skeleton (the permanent order), then the window reorder — but only
  // within CONTIGUOUS RUNS of window slots: a window item may never cross a
  // frozen (far/undated/dead) item in either direction, so the relative order
  // of every (near, far) pair is invariant across modes (Calvin's C3, pairwise).
  const scored = items.map((it) => {
    const cap = captureOf(it);
    const vSlack = leverage(it.grade) * Math.pow(it.weight, P_SLACK) * cap;
    const vCrunch = leverage(it.grade) * Math.pow(it.weight, p) * cap;
    const dead = it.d !== null && it.d < 0 && vSlack <= 1e-9;
    const inWindow = !dead && it.d !== null && it.d <= span; // recoverable overdue (d<0) is "now" work → in
    return { it, vSlack, vCrunch, dead, undated: it.d === null, inWindow };
  });
  const tie = (a: (typeof scored)[number], b: (typeof scored)[number]) =>
    a.it.name.localeCompare(b.it.name) || a.it.canvasId - b.it.canvasId;
  scored.sort((a, b) => Number(a.dead) - Number(b.dead) || Number(a.undated) - Number(b.undated) || b.vSlack - a.vSlack || tie(a, b));
  const ranked = scored.slice();
  let run: number[] = [];
  const flushRun = () => {
    if (run.length > 1) {
      const sortedRun = run.map((i) => scored[i]).sort((a, b) => b.vCrunch - a.vCrunch || tie(a, b));
      run.forEach((slot, k) => { ranked[slot] = sortedRun[k]; });
    }
    run = [];
  };
  for (let i = 0; i < scored.length; i++) {
    if (scored[i].inWindow) run.push(i);
    else flushRun();
  }
  flushRun();
  return { rho, dstar, p, span, profile, ranked };
}

const cShort = (n: string) => (/2025F-05/.test(n) ? "Micro" : /2025F-10/.test(n) ? "FME" : /2026SP-01/.test(n) ? "Finance" : n.slice(0, 8));

async function main() {
  const dateArg = process.argv.find((a) => a.startsWith("--date="))?.slice(7);
  if (dateArg && Number.isNaN(new Date(dateArg + "T09:00:00").getTime())) { console.error(`invalid --date: ${dateArg}`); process.exit(1); }
  const now = dateArg ? new Date(dateArg + "T09:00:00") : new Date();
  console.log(`vantage date: ${now.toISOString().slice(0, 10)}${dateArg ? " (simulated)" : " (real today)"}`);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: USER } });
  const rows = await prisma.assignment.findMany({ where: { userId: USER }, include: { course: true }, orderBy: { canvasId: "asc" } });
  const isDone = (a: (typeof rows)[number]) => a.submittedAt !== null && a.submissionState !== "unsubmitted";
  const active = rows.filter((a) => !isDone(a));
  const totals = courseTotalPoints(rows.map((a) => ({ courseCanvasId: a.courseCanvasId, pointsPossible: a.pointsPossible })));

  const screened = active.filter((a) => {
    const t = itemType(a.submissionType, a.name);
    return !(a.aiRequiresAction === false && !requiresOnlineSubmission(a.submissionType) && !isStudyType(t));
  });

  const items: PItem[] = screened.map((a) => {
    const t = itemType(a.submissionType, a.name);
    const study = isStudyType(t);
    const tier = study ? assessmentTier(t, a.name) : null;
    const lead = !study ? 0 : a.studyLeadDays ?? (tier === "final" ? user.studyDaysFinal : tier === "exam" ? user.studyDaysTest : user.studyDaysQuiz);
    const total = totals.get(a.courseCanvasId) ?? 0;
    const pointsShare = total > 0 && a.pointsPossible != null ? a.pointsPossible / total : null;
    return {
      canvasId: a.canvasId, name: a.name, courseName: a.course.name,
      d: daysUntil(a.dueAt, now),
      weight: resolveWeight(a.gradeWeight ?? pointsShare, t),
      grade: a.course.currentScore != null ? a.course.currentScore / 100 : null,
      lp: a.course.latePolicyKind ? coerceLatePolicy({ kind: a.course.latePolicyKind, value: a.course.latePolicyValue }) : DEFAULT_LATE_POLICY,
      effort: effectiveEffort(a) ?? user.defaultEffortHours,
      isStudy: study, lead, points: a.pointsPossible, type: t,
    };
  });

  const prodRanked = rankActiveRows(
    active.map((a): RankableRow => ({
      canvasId: a.canvasId, name: a.name, courseName: a.course.name, courseCanvasId: a.courseCanvasId,
      dueAt: a.dueAt, pointsPossible: a.pointsPossible, htmlUrl: a.htmlUrl, submissionType: a.submissionType,
      estimatedEffortHours: effectiveEffort(a),
      courseGrade: a.course.currentScore != null ? a.course.currentScore / 100 : null,
      gradeWeight: a.gradeWeight,
      latePolicy: a.course.latePolicyKind ? coerceLatePolicy({ kind: a.course.latePolicyKind, value: a.course.latePolicyValue }) : undefined,
      requiresAction: a.aiRequiresAction,
    })),
    totals, user.defaultEffortHours, now,
  );
  const prodRank = new Map(prodRanked.map((r, i) => [r.canvasId, i + 1]));

  const Hs = process.argv.slice(2).filter((a) => !a.startsWith("--")).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  const scenarios = Hs.length ? Hs : [8, user.defaultHoursPerDay, 1.5];

  const results: { H: number; rho: number; p: number; ranked: ReturnType<typeof rankScenario>["ranked"] }[] = [];
  for (const H of scenarios) {
    const { rho, dstar, p, span, profile, ranked } = rankScenario(items, H);
    results.push({ H, rho, p, ranked });
    const mode = rho >= RAMP_HI ? "FULL CRUNCH" : rho > RAMP_LO ? "PARTIAL CRUNCH" : "SLACK";
    console.log(`\n${"=".repeat(100)}`);
    console.log(`=== H = ${H}h/day   →   ρ = ${rho.toFixed(2)} (binding: day ${dstar}, contested span: ${span}d)   p = ${p.toFixed(2)}   MODE: ${mode} ===`);
    console.log("effective load (fade·L): " + profile.filter((x) => x.d <= 16).map((x) => `d${x.d}:${x.eff.toFixed(2)}`).join(" "));

    console.log(`\n#   (prod#  Δ)   course   | item — due · pts   († = inside the contested span)`);
    ranked.slice(0, 22).forEach((r, i) => {
      const pr = prodRank.get(r.it.canvasId);
      const delta = pr ? pr - (i + 1) : 0;
      const dtxt = r.it.d === null ? "undated" : r.it.d < 0 ? `${-r.it.d}d overdue` : `in ${r.it.d}d`;
      const arrow = pr === undefined ? "  new" : delta > 0 ? `↑${delta}` : delta < 0 ? `↓${-delta}` : "·";
      console.log(`${String(i + 1).padStart(2)}. (prod #${String(pr ?? "—").padStart(3)} ${arrow.padStart(4)})  ${cShort(r.it.courseName).padEnd(8)} | ${(r.inWindow ? "†" : " ")}${r.it.name.slice(0, 51).padEnd(51)} ${dtxt} · ${r.it.points ?? "?"}pts${r.it.isStudy ? " [STUDY]" : ""}`);
    });

    const exams = ranked.map((r, i) => ({ r, i })).filter((x) => x.r.it.isStudy && x.r.it.d !== null && x.r.it.d >= 0);
    console.log("\nupcoming assessments:");
    for (const { r, i } of exams.slice(0, 6)) console.log(`  #${String(i + 1).padStart(3)} (prod #${prodRank.get(r.it.canvasId) ?? "—"})  ${r.it.name.slice(0, 46).padEnd(46)} exam in ${r.it.d}d · ${r.it.points}pts · ${cShort(r.it.courseName)}`);
  }

  if (results.length >= 2) {
    const a = results[0], b = results[results.length - 1];
    const posA = new Map(a.ranked.map((r, i) => [r.it.canvasId, i]));
    const posB = new Map(b.ranked.map((r, i) => [r.it.canvasId, i]));
    const top = new Set([...a.ranked.slice(0, 30), ...b.ranked.slice(0, 30)].map((r) => r.it.canvasId));
    const moves = [...top].map((id) => ({ dA: posA.get(id)!, dB: posB.get(id)!, it: a.ranked[posA.get(id)!].it }))
      .map((x) => ({ ...x, move: x.dA - x.dB }))
      .sort((x, y) => Math.abs(y.move) - Math.abs(x.move))
      .slice(0, 10);
    console.log(`\n${"=".repeat(100)}\n=== movers: H=${a.H} → H=${b.H} (positive = climbs when time is tighter) ===`);
    for (const m of moves) {
      const dir = m.move > 0 ? `↑${m.move}` : m.move < 0 ? `↓${-m.move}` : "·";
      console.log(`  ${dir.padStart(4)}  #${m.dA + 1} → #${m.dB + 1}   ${m.it.name.slice(0, 46).padEnd(46)} due ${m.it.d === null ? "—" : m.it.d + "d"} · ${m.it.points}pts`);
    }
    const farMoved = [...posA.keys()].filter((id) => {
      const it = a.ranked[posA.get(id)!].it;
      return (it.d === null || it.d > WINDOW) && posA.get(id) !== posB.get(id);
    });
    // PAIRWISE invariant (the sandwich fix): for every pair with at least one
    // far/undated member, the relative order must be identical in both modes.
    const ids = [...posA.keys()];
    const isFar = new Map(ids.map((id) => { const it = a.ranked[posA.get(id)!].it; return [id, it.d === null || it.d > WINDOW] as const; }));
    let pairFlips = 0;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      if (!isFar.get(ids[i]) && !isFar.get(ids[j])) continue;
      const ordA = posA.get(ids[i])! < posA.get(ids[j])!, ordB = posB.get(ids[i])! < posB.get(ids[j])!;
      if (ordA !== ordB) pairFlips++;
    }
    console.log(`\nC3/C4 structural checks — far/undated position moves: ${farMoved.length} (must be 0); near↔far pairwise order flips: ${pairFlips} (must be 0)`);
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
