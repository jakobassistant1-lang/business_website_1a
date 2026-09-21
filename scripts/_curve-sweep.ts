// Sweep: curve SHAPE x points-exponent p (value = leverage * weight^p * capture).
// p=1 is today; lower p dials down how hard points push the ranking. Goal: find a
// (shape, p) where near-term wins, heavier-non-imminent still wins (Q3), leverage
// holds, and month-away loses — all at once. Standalone math, no lib edit.
const LAMBDA = 0.02;
const HYBRID: [number, number][] = [[0, 1], [1, 0.64], [2, 0.42], [3, 0.28], [4, 0.19], [5, 0.155], [6, 0.13], [7, 0.11], [9, 0.085], [11, 0.067], [14, 0.048], [18, 0.032], [24, 0.016], [32, 0.007], [45, 0]];
const CONVEX: [number, number][] = [[0, 1], [1, 0.64], [2, 0.42], [3, 0.28], [4, 0.19], [5, 0.13], [6, 0.095], [7, 0.07], [9, 0.04], [12, 0.02], [16, 0.009], [22, 0.003], [30, 0]];

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
const lev = (g?: number) => { const gg = g == null ? 0.85 : g; return Math.max(0.1, Math.min(1, 1 - gg)); };
const cap = (curve: [number, number][], d: number) => LAMBDA + (1 - LAMBDA) * lerp(curve, d);
type It = { w: number; d: number; g?: number };
const value = (curve: [number, number][], it: It, p: number) => lev(it.g) * Math.pow(it.w, p) * cap(curve, it.d);

type Sc = { label: string; a: It; b: It; must: boolean };
const S: Sc[] = [
  { label: "Q1  30@1  vs 90@4    near-term", a: { w: 30, d: 1 }, b: { w: 90, d: 4 }, must: true },
  { label: "Q3  180@4 vs 40@3    heavier-non-imm", a: { w: 180, d: 4 }, b: { w: 40, d: 3 }, must: true },
  { label: "Q15 .5@C  vs .5@A     leverage", a: { w: 0.5, d: 3, g: 0.72 }, b: { w: 0.5, d: 3, g: 0.94 }, must: true },
  { label: "Q21 .5@C  vs 1@A      lev>2x wt", a: { w: 0.5, d: 3, g: 0.72 }, b: { w: 1.0, d: 3, g: 0.94 }, must: true },
  { label: "BUG Ann6d vs Sess40d  month-away", a: { w: 0.0168, d: 6 }, b: { w: 0.0915, d: 40 }, must: true },
  { label: "EQ1 50@3  vs 50@10    closer", a: { w: 50, d: 3 }, b: { w: 50, d: 10 }, must: true },
  { label: "EQ2 100@7 vs 100@14   closer", a: { w: 100, d: 7 }, b: { w: 100, d: 14 }, must: true },
  { label: "Q2  15@1  vs 200@3    imm vs 13x", a: { w: 15, d: 1 }, b: { w: 200, d: 3 }, must: false },
  { label: "Q4  20@2  vs 150@4    imm vs 7.5x", a: { w: 20, d: 2 }, b: { w: 150, d: 4 }, must: false },
  { label: "M1  30@3  vs 120@7    wk vs 4x next-wk", a: { w: 30, d: 3 }, b: { w: 120, d: 7 }, must: false },
  { label: "M2  50@5  vs 150@12   wk vs 3x 12d", a: { w: 50, d: 5 }, b: { w: 150, d: 12 }, must: false },
];
const ps = [1.0, 0.6, 0.45, 0.35, 0.3, 0.25, 0.2];

for (const [cname, curve] of [["HYBRID", HYBRID], ["CONVEX", CONVEX]] as const) {
  console.log(`\n===== ${cname} — points exponent p (cell = winner; want A, "B!" = breaks) =====`);
  console.log("  scenario".padEnd(34) + ps.map((p) => ("p" + p.toFixed(2)).padEnd(5)).join(""));
  for (const s of S) {
    const cells = ps.map((p) => { const aw = value(curve, s.a, p) > value(curve, s.b, p); return (aw ? "A" : "B!").padEnd(5); });
    console.log((s.must ? "* " : "  ") + s.label.padEnd(32) + cells.join(""));
  }
  const must = S.filter((s) => s.must);
  const sm = ps.map((p) => must.filter((s) => value(curve, s.a, p) > value(curve, s.b, p)).length);
  const sa = ps.map((p) => S.filter((s) => value(curve, s.a, p) > value(curve, s.b, p)).length);
  console.log("  MUST-pass /" + must.length + (" ").repeat(20) + sm.map((x) => String(x).padEnd(5)).join(""));
  console.log("  ALL-pass  /" + S.length + (" ").repeat(20) + sa.map((x) => String(x).padEnd(5)).join(""));
}
