// Acceptance harness v2 for the crunch-aware prioritizer (post-rulings 2026-07-21).
// Mirrors _crunch-proto.ts machinery exactly: C1 capacity H·(d+1), horizon fade
// (full ≤7d → zero at 21d), study demand spread over the lead window, ONE global
// p = 0.15 + 0.6·clamp((ρ−0.8)/0.7), and the slot-stable WINDOW reorder (≤14d).
// Part 1: forced-p pairwise preferences (all near pairs — valid, since within the
// window ranking is by value at p). Part 2: full-machinery scenarios incl. Calvin's
// re-ruled case A, the ordinary-evening check, and the C3/C4 structural cases.
// Run: npx tsx scripts/_crunch-accept.ts
import { leverage, LAMBDA, OVERDUE_FRACTION, DEFAULT_STUDY_BASELINE } from "../lib/marginalPriority";
import { salvageFraction, slipLoss, DEFAULT_LATE_POLICY, type LatePolicy } from "../lib/latePolicy";

const P_SLACK = 0.15, P_CRUNCH = 0.75, RAMP_LO = 0.8, RAMP_HI = 1.5;
const WINDOW = 14, FADE_FULL = 7, FADE_ZERO = 21;
const HYBRID: [number, number][] = [[0, 1], [1, 0.64], [2, 0.42], [3, 0.28], [4, 0.19], [5, 0.155], [6, 0.13], [7, 0.11], [9, 0.085], [11, 0.067], [14, 0.048], [18, 0.032], [24, 0.016], [32, 0.007], [45, 0]];
const STUDY_V2: [number, number][] = [[0, 1], [1, 1], [2, 0.85], [3, 0.55], [5, 0.34], [7, 0.24], [10, 0.14], [14, 0.07], [21, 0.03], [30, 0.012], [45, 0]];

function lerp(c: [number, number][], x: number): number {
  if (x <= c[0][0]) return c[0][1];
  const last = c[c.length - 1]; if (x >= last[0]) return last[1];
  for (let i = 1; i < c.length; i++) { const [x0, y0] = c[i - 1], [x1, y1] = c[i]; if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); }
  return last[1];
}
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const pOf = (rho: number) => P_SLACK + (P_CRUNCH - P_SLACK) * clamp01((rho - RAMP_LO) / (RAMP_HI - RAMP_LO));

type It = { name?: string; w: number; d: number | null; kind?: "study"; grade?: number; lp?: LatePolicy; eff?: number; lead?: number };
function capture(i: It): number {
  if (i.kind === "study") {
    if (i.d === null || i.d < 0) return 0;
    return clamp01(1 - (i.grade ?? DEFAULT_STUDY_BASELINE)) * lerp(STUDY_V2, i.d);
  }
  const lp = i.lp ?? DEFAULT_LATE_POLICY;
  if (i.d === null) return LAMBDA;
  if (i.d < 0) return salvageFraction(lp, -i.d) * OVERDUE_FRACTION;
  return LAMBDA + (1 - LAMBDA) * lerp(HYBRID, i.d) * slipLoss(lp);
}
const val = (i: It, p: number) => leverage(i.grade ?? null) * Math.pow(i.w, p) * capture(i);

// full machinery: ρ from demand (C1 + fade + study spread), then slot-stable rank
function loadStats(items: It[], H: number): { rho: number; span: number } {
  const dl = new Map<number, number>();
  for (const it of items) {
    if (it.d === null) continue;
    const eff = it.eff ?? 0;
    if (it.d < 0) {
      // only still-bleeding (perday) overdue presses on the schedule, scaled by salvage
      const lp = it.lp ?? DEFAULT_LATE_POLICY;
      if (it.kind !== "study" && lp.kind === "perday") {
        const s = salvageFraction(lp, -it.d);
        if (s > 0) dl.set(0, (dl.get(0) ?? 0) + eff * s);
      }
      continue;
    }
    if (it.kind === "study") {
      const S = Math.max(1, Math.min(it.lead ?? 7, it.d) + 1);
      for (let k = 0; k < S; k++) dl.set(it.d - k, (dl.get(it.d - k) ?? 0) + eff / S);
    } else dl.set(it.d, (dl.get(it.d) ?? 0) + eff);
  }
  let cum = 0, rho = 0, span = 0;
  for (const d of [...dl.keys()].sort((a, b) => a - b)) {
    cum += dl.get(d)!;
    const fade = d <= FADE_FULL ? 1 : Math.max(0, (FADE_ZERO - d) / (FADE_ZERO - FADE_FULL));
    const eff = (cum / (H * (d + 1))) * fade;
    rho = Math.max(rho, eff);
    if (eff >= RAMP_LO && d <= WINDOW) span = Math.max(span, d);
  }
  return { rho, span };
}
function rank(items: It[], H: number): { order: string[]; rho: number; p: number; span: number } {
  const { rho, span } = loadStats(items, H);
  const p = pOf(rho);
  const scored = items.map((it) => {
    const vS = val(it, P_SLACK), vC = val(it, p);
    const dead = it.d !== null && it.d < 0 && vS <= 1e-9;
    return { it, vS, vC, dead, undated: it.d === null, inWindow: !dead && it.d !== null && it.d <= span };
  });
  scored.sort((a, b) => Number(a.dead) - Number(b.dead) || Number(a.undated) - Number(b.undated) || b.vS - a.vS || (a.it.name ?? "").localeCompare(b.it.name ?? ""));
  // contiguous-run reorder: window items never cross a frozen item in either direction
  const out = scored.slice();
  let run: number[] = [];
  const flush = () => {
    if (run.length > 1) {
      const sr = run.map((i) => scored[i]).sort((a, b) => b.vC - a.vC || (a.it.name ?? "").localeCompare(b.it.name ?? ""));
      run.forEach((s, k) => { out[s] = sr[k]; });
    }
    run = [];
  };
  for (let i = 0; i < scored.length; i++) { if (scored[i].inWindow) run.push(i); else flush(); }
  flush();
  return { order: out.map((x) => x.it.name ?? "?"), rho, p, span };
}

// ---- Part 1: forced-p pairwise preferences (near pairs — window-internal) ----
type Row = { id: string; label: string; A: It; B: It; orig: "A" | "B"; onFlip: string; close?: boolean };
const PERDAY10: LatePolicy = { kind: "perday", value: 0.1 };
const R: Row[] = [
  { id: "Q1", label: "30pt @1d  vs 90pt @4d", A: { w: 30, d: 1 }, B: { w: 90, d: 4 }, orig: "A", onFlip: "must hold BOTH" },
  { id: "Q2", label: "15pt @1d  vs 200pt @3d", A: { w: 15, d: 1 }, B: { w: 200, d: 3 }, orig: "A", onFlip: "crunch-flip OK (can't do both → 200 wins)" },
  { id: "Q3", label: "180pt @4d vs 40pt @3d", A: { w: 180, d: 4 }, B: { w: 40, d: 3 }, orig: "A", onFlip: "slack-flip OK (both fit → sooner first)" },
  { id: "Q4", label: "20pt @2d  vs 150pt @4d", A: { w: 20, d: 2 }, B: { w: 150, d: 4 }, orig: "A", onFlip: "crunch-flip OK" },
  { id: "Q15", label: "0.5 @C vs 0.5 @A (leverage)", A: { w: 0.5, d: 3, grade: 0.72 }, B: { w: 0.5, d: 3, grade: 0.94 }, orig: "A", onFlip: "must hold BOTH" },
  { id: "Q21", label: "0.5 @C vs 1.0 @A (lev beats 2× wt)", A: { w: 0.5, d: 3, grade: 0.72 }, B: { w: 1.0, d: 3, grade: 0.94 }, orig: "A", onFlip: "must hold BOTH" },
  { id: "Q18", label: "study shaky vs acing, eq wt", A: { w: 0.25, d: 3, kind: "study", grade: 0.5 }, B: { w: 0.25, d: 3, kind: "study", grade: 0.9 }, orig: "A", onFlip: "must hold BOTH" },
  { id: "Q5", label: "do 100 @3d vs study 100 @3d", A: { w: 100, d: 3 }, B: { w: 100, d: 3, kind: "study" }, orig: "A", onFlip: "should hold BOTH" },
  { id: "Q6", label: "study 200 final @3d vs do 30 @3d", A: { w: 200, d: 3, kind: "study" }, B: { w: 30, d: 3 }, orig: "A", onFlip: "must hold BOTH" },
  { id: "Q16", label: "study 100 @3d vs do 50 @3d", A: { w: 100, d: 3, kind: "study" }, B: { w: 50, d: 3 }, orig: "A", onFlip: "should hold BOTH" },
  { id: "Q17", label: "study 100 ≈ do 75 @3d (closeness)", A: { w: 100, d: 3, kind: "study" }, B: { w: 75, d: 3 }, orig: "A", onFlip: "closeness <15% is the criterion", close: true },
  { id: "Q20", label: "do 50 @3d vs study 100 @5d", A: { w: 50, d: 3 }, B: { w: 100, d: 5, kind: "study" }, orig: "A", onFlip: "should hold BOTH" },
  { id: "Q7", label: "do 30 @1d vs study 100 @2d", A: { w: 30, d: 1 }, B: { w: 100, d: 2, kind: "study" }, orig: "A", onFlip: "crunch-flip OK (exam wins in a crunch)", close: true },
  { id: "Q8", label: "study 100 @1d vs do 25 @0d", A: { w: 100, d: 1, kind: "study" }, B: { w: 25, d: 0 }, orig: "A", onFlip: "slack-flip arguable (both get done today)" },
  { id: "EQ1", label: "50 @3d vs 50 @10d", A: { w: 50, d: 3 }, B: { w: 50, d: 10 }, orig: "A", onFlip: "must hold BOTH" },
  { id: "EQ2", label: "100 @7d vs 100 @14d", A: { w: 100, d: 7 }, B: { w: 100, d: 14 }, orig: "A", onFlip: "must hold BOTH" },
  { id: "Q9", label: "recov. overdue 20 @-2d vs 100 @3d", A: { w: 20, d: -2, lp: PERDAY10 }, B: { w: 100, d: 3 }, orig: "A", onFlip: "crunch flip — AWAITING Calvin's ruling" },
];

console.log("=== PART 1: pairwise preferences at forced p — slack(0.15) / crunch(0.75), raw & /1000 weights ===\n");
console.log("id    scenario".padEnd(44) + "slack[raw] slack[frac] crunch[raw] crunch[frac]  orig  note");
for (const r of R) {
  const frac = (i: It): It => ({ ...i, w: i.w / 1000 }); // uniform scale keeps ratios (fixes the Q21 cell bug)
  const cells: string[] = [];
  for (const [p, fr] of [[P_SLACK, false], [P_SLACK, true], [P_CRUNCH, false], [P_CRUNCH, true]] as const) {
    const A = fr ? frac(r.A) : r.A, B = fr ? frac(r.B) : r.B;
    const va = val(A, p), vb = val(B, p);
    const w = va > vb ? "A" : "B";
    const closeness = Math.abs(va - vb) / Math.max(va, vb);
    cells.push((w === r.orig ? w + " ✓" : w + " ✗") + (r.close ? ` ${(closeness * 100).toFixed(0)}%` : ""));
  }
  console.log(`${r.id.padEnd(5)} ${r.label.padEnd(38)}` + cells.map((c) => c.padEnd(11)).join(" ") + ` ${r.orig}    ${r.onFlip}`);
}

// ---- Part 2: full-machinery scenarios (H=3, fractional weights /1789) ----
console.log("\n=== PART 2: full machinery (C1 counting · fade · study spread · window reorder), H=3 ===\n");
type Case = { id: string; items: It[]; check: (o: string[]) => boolean; want: string };
const F = 1789;
const CASES: Case[] = [
  {
    id: "A  (re-ruled): big 100pt/6h @2d vs small 10pt/1h @1d — now FEASIBLE counting today → small first",
    items: [{ name: "BIG", w: 100 / F, d: 2, eff: 6 }, { name: "small", w: 10 / F, d: 1, eff: 1 }],
    check: (o) => o[0] === "small", want: "small first (Calvin 2026-07-21: today counts, so both fit)",
  },
  {
    id: "B  slack: big 100pt/6h @4d vs small @1d",
    items: [{ name: "BIG", w: 100 / F, d: 4, eff: 6 }, { name: "small", w: 10 / F, d: 1, eff: 1 }],
    check: (o) => o[0] === "small", want: "small first",
  },
  {
    id: "C  easy-imminent: big 100pt/2h @2d vs small @1d",
    items: [{ name: "BIG", w: 100 / F, d: 2, eff: 2 }, { name: "small", w: 10 / F, d: 1, eff: 1 }],
    check: (o) => o[0] === "small", want: "small first",
  },
  {
    id: "E  heavy-far: big 300pt/16h @4d vs small @1d",
    items: [{ name: "BIG", w: 300 / F, d: 4, eff: 16 }, { name: "small", w: 10 / F, d: 1, eff: 1 }],
    check: (o) => o[0] === "BIG", want: "BIG first (genuine crunch)",
  },
  {
    id: "EVENING: quiz 1h @0d + set 2h @1d + reading 1h @1d — ordinary school night",
    items: [{ name: "quiz", w: 15 / F, d: 0, eff: 1 }, { name: "set", w: 30 / F, d: 1, eff: 2 }, { name: "reading", w: 10 / F, d: 1, eff: 1 }],
    check: () => true, want: "MODE = SLACK (was the false-crunch bug)",
  },
  {
    id: "C3-STRESS: 12× wt ratio under full crunch — 8pt @6d vs 100pt @40d (+12h filler @1d)",
    items: [{ name: "quiz8", w: 8 / 1000, d: 6, eff: 1 }, { name: "paper100", w: 100 / 1000, d: 40, eff: 10 }, { name: "filler", w: 50 / 1000, d: 1, eff: 12 }],
    check: (o) => o.indexOf("quiz8") < o.indexOf("paper100"), want: "quiz8 above paper100 even at p=0.75 (Calvin: month-away never outranks)",
  },
  {
    id: "C4-CHURN: far pair stable across modes — X 20pt @16d vs Y 100pt @30d (± crunch filler)",
    items: [{ name: "X", w: 20 / 1000, d: 16, eff: 1 }, { name: "Y", w: 100 / 1000, d: 30, eff: 10 }],
    check: () => true, want: "same X/Y order with and without a crunch (structural)",
  },
  {
    id: "CRAM: exam tomorrow, 12h prep (spread over lead) — honest scarcity should read crunch",
    items: [{ name: "examStudy", w: 100 / F, d: 1, kind: "study", eff: 12, lead: 7 }, { name: "small", w: 10 / F, d: 1, eff: 1 }],
    check: (o) => o[0] === "examStudy", want: "crunch mode + exam first",
  },
  {
    id: "FINAL-10d: lone 15h final @10d (lead 14) — demand visible this week, no self-inflicted cliff",
    items: [{ name: "finalStudy", w: 200 / F, d: 10, kind: "study", eff: 15, lead: 14 }, { name: "hw", w: 20 / F, d: 2, eff: 1 }],
    check: () => true, want: "info: ρ reflects spread demand now",
  },
  // --- regression cases from the v2 red-team ---
  {
    id: "SANDWICH: far item interleaved between swapping window items (math-audit counterexample)",
    items: [{ name: "A2pct", w: 0.02, d: 9, eff: 1 }, { name: "B15pct", w: 0.15, d: 14, eff: 2 }, { name: "F35pct", w: 0.35, d: 16, eff: 2 }, { name: "filler", w: 0.05, d: 0, eff: 7 }],
    check: (o) => o.indexOf("A2pct") < o.indexOf("F35pct"), want: "A2pct (9d) stays above frozen F35pct (16d) — near never sinks through far",
  },
  {
    id: "QUIZ-TMRW: quiz @1d must not sink below frozen month-away papers (red-team roster)",
    items: [{ name: "quiz10", w: 0.01, d: 1, eff: 1, grade: 0.94 }, { name: "paper25d", w: 0.1, d: 25, eff: 4, grade: 0.5 }, { name: "paper30d", w: 0.1, d: 30, eff: 4, grade: 0.5 }, { name: "midterm", w: 0.25, d: 13, kind: "study", eff: 6, grade: 0.5, lead: 7 }, { name: "filler", w: 0.05, d: 0, eff: 7 }],
    check: (o) => o.indexOf("quiz10") < o.indexOf("paper25d") && o.indexOf("quiz10") < o.indexOf("paper30d"), want: "quiz-due-tomorrow above both far papers in any mode",
  },
  {
    id: "FLAT-OVERDUE: 5h essay flat-30% policy 20d overdue + ordinary evening — no permanent false crunch",
    items: [{ name: "oldEssay", w: 0.08, d: -20, eff: 5, lp: { kind: "flat", value: 0.3 } }, { name: "quiz", w: 15 / F, d: 0, eff: 1 }, { name: "set", w: 30 / F, d: 1, eff: 2 }, { name: "reading", w: 10 / F, d: 1, eff: 1 }],
    check: (o) => o.indexOf("quiz") < o.indexOf("set"), want: "MODE = SLACK (flat overdue has no time pressure) + evening order intact",
  },
  {
    id: "SPIKE: 12h exam prep tonight must NOT re-triage items due 9-13d out (contested span scoping)",
    items: [{ name: "examStudy", w: 100 / F, d: 1, kind: "study", eff: 12, lead: 7 }, { name: "lab", w: 15 / F, d: 2, eff: 1 }, { name: "essay9d", w: 150 / F, d: 9, eff: 5 }, { name: "proj13d", w: 200 / F, d: 13, eff: 6 }],
    check: (o) => o.indexOf("lab") < o.indexOf("essay9d") && o.indexOf("essay9d") < o.indexOf("proj13d"), want: "spike triages only the contested days; 9d/13d items keep slack order",
  },
];
for (const c of CASES) {
  const { order, rho, p } = rank(c.items, 3);
  const ok = c.check(order);
  const mode = rho >= RAMP_HI ? "FULL CRUNCH" : rho > RAMP_LO ? "PARTIAL" : "SLACK";
  console.log(`${ok ? "✓" : "✗"} ${c.id}`);
  console.log(`    ρ=${rho.toFixed(2)} p=${p.toFixed(2)} ${mode} → [${order.join(" > ")}]   want: ${c.want}`);
}
// C4 structural: compare far-pair order with vs without a crunch inducer
{
  const base: It[] = [{ name: "X", w: 20 / 1000, d: 16, eff: 1 }, { name: "Y", w: 100 / 1000, d: 30, eff: 10 }];
  const calm = rank(base, 3);
  const crunched = rank([...base, { name: "filler", w: 50 / 1000, d: 1, eff: 14 }], 3);
  const xy = (o: string[]) => (o.indexOf("X") < o.indexOf("Y") ? "X>Y" : "Y>X");
  const stable = xy(calm.order) === xy(crunched.order);
  console.log(`${stable ? "✓" : "✗"} C4 verdict: calm ${xy(calm.order)} (ρ=${calm.rho.toFixed(2)}) vs crunched ${xy(crunched.order)} (ρ=${crunched.rho.toFixed(2)}) — far pair ${stable ? "STABLE" : "CHURNED"}`);
}
