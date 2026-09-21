// Compare three urgency-curve shapes on the key scenarios (standalone math, no lib edit):
//   CLIFF   = current (flat 0–2, drop at 3, flat tail)
//   REV_S   = proposed reverse-S (shallow, steep 4–7, shallow)
//   CONVEX  = steepest at day 0, gradually shallower (front-loaded decay)
const LAMBDA = 0.02;
const LEV = 0.15; // leverage(null grade), same for all → cancels

const CLIFF: [number, number][] = [[0, 1], [1, 1], [2, 1], [3, 0.04], [30, 0]];
const REV_S: [number, number][] = [[0, 1], [1, 0.97], [2, 0.92], [3, 0.86], [4, 0.77], [5, 0.67], [6, 0.56], [7, 0.46], [9, 0.34], [11, 0.26], [14, 0.18], [18, 0.12], [24, 0.06], [32, 0.025], [45, 0]];
const CONVEX: [number, number][] = [[0, 1], [1, 0.64], [2, 0.42], [3, 0.28], [4, 0.19], [5, 0.13], [6, 0.095], [7, 0.07], [9, 0.04], [12, 0.02], [16, 0.009], [22, 0.003], [30, 0]];
// HYBRID: convex 0–4 (unchanged), then the S-curve's decelerating tail shape from 7+
const HYBRID: [number, number][] = [[0, 1], [1, 0.64], [2, 0.42], [3, 0.28], [4, 0.19], [5, 0.155], [6, 0.13], [7, 0.11], [9, 0.085], [11, 0.067], [14, 0.048], [18, 0.032], [24, 0.016], [32, 0.007], [45, 0]];

function lerp(curve: [number, number][], x: number): number {
  if (x <= curve[0][0]) return curve[0][1];
  const last = curve[curve.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < curve.length; i++) {
    const [x0, y0] = curve[i - 1], [x1, y1] = curve[i];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return last[1];
}
const value = (curve: [number, number][], weight: number, days: number) => LEV * weight * (LAMBDA + (1 - LAMBDA) * lerp(curve, days));

function check(label: string, aW: number, aDays: number, bW: number, bDays: number, wantA: boolean) {
  console.log(label + `   (ideal: A wins)`);
  for (const [name, curve] of [["cliff  ", CLIFF], ["rev-S  ", REV_S], ["convex ", CONVEX], ["hybrid ", HYBRID]] as const) {
    const va = value(curve, aW, aDays), vb = value(curve, bW, bDays);
    const aWins = va > vb;
    console.log(`   ${name}: ${aWins ? "A" : "B"} wins  (A=${va.toFixed(4)} B=${vb.toFixed(4)})  ${aWins === wantA ? "✓" : "✗"}`);
  }
  console.log("");
}

console.log("Q1: 30pt tomorrow  vs  90pt in 4 days   <- you said: do the 30pt first");
check("", 30, 1, 90, 4, true);
console.log("Q2: 15pt tomorrow  vs  200pt in 3 days  (strict imminence, ~13x gap)");
check("", 15, 1, 200, 3, true);
console.log("Q4: 20pt in 2 days vs  150pt in 4 days");
check("", 20, 2, 150, 4, true);
console.log("Q3: 180pt in 4 days vs 40pt in 3 days   (non-imminent: heavier should win)");
check("", 180, 4, 40, 3, true);
console.log("BUG: this-week beats month-away  — Annuities(1.68%,6d) vs Session(9.15%,40d)");
check("", 0.0168, 6, 0.0915, 40, true);
console.log("Equal weight, closer should win — 50pt in 3d vs 50pt in 10d");
check("", 50, 3, 50, 10, true);
console.log("Equal weight, week apart — 100pt in 7d vs 100pt in 14d");
check("", 100, 7, 100, 14, true);
