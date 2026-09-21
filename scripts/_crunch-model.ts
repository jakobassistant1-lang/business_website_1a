// Express "points matter more in a crunch" three ways and test against Calvin's cases.
// value = leverage * pts^p * urgency(day). The question is how p should move.
//   fixed-p   : p constant (today's model, p=0.40)
//   days-slide: p rises as the deadline nears (Calvin's first idea) — p = f(days)
//   load-slide: p rises with CRUNCH — p = f(ρ), ρ = work-due-by-deadline / time-available
// Crunch ρ uses effort + a daily capacity H, so it actually knows if both fit.
const LAMBDA = 0.02, H = 3; // H = hours/day the student has
const HYBRID: [number, number][] = [[0, 1], [1, 0.64], [2, 0.42], [3, 0.28], [4, 0.19], [5, 0.155], [6, 0.13], [7, 0.11], [9, 0.085], [11, 0.067], [14, 0.048], [18, 0.032], [24, 0.016], [32, 0.007], [45, 0]];
function lerp(c: [number, number][], x: number): number {
  if (x <= c[0][0]) return c[0][1];
  const last = c[c.length - 1]; if (x >= last[0]) return last[1];
  for (let i = 1; i < c.length; i++) { const [x0, y0] = c[i - 1], [x1, y1] = c[i]; if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); }
  return last[1];
}
const u = (d: number) => lerp(HYBRID, d);
const cap = (d: number) => LAMBDA + (1 - LAMBDA) * u(d);
const value = (pts: number, day: number, p: number) => Math.pow(pts, p) * cap(day); // same leverage → dropped

type Item = { name: string; pts: number; eff: number; day: number };
// ρ for an item = worst demand/supply ratio at any deadline up to its own (EDF feasibility test)
function crunch(items: Item[], byDay: number): number {
  const ds = [...new Set(items.map((i) => i.day))].filter((d) => d > 0 && d <= byDay).sort((a, b) => a - b);
  let m = 0;
  for (const d of ds) { const demand = items.filter((i) => i.day <= d).reduce((s, i) => s + i.eff, 0); m = Math.max(m, demand / (d * H)); }
  return m;
}
const P_SLACK = 0.15, P_CRUNCH = 0.75;
const ramp = (rho: number) => Math.max(0, Math.min(1, (rho - 0.8) / (1.5 - 0.8))); // 0 below .8, 1 at 1.5
const pLoad = (rho: number) => P_SLACK + (P_CRUNCH - P_SLACK) * ramp(rho);
const pDays = (d: number) => P_SLACK + (P_CRUNCH - P_SLACK) * u(d);

const cases: { label: string; big: Item; small: Item; want: string }[] = [
  { label: "A  crunch:        big 100pt/6h @2d  vs small 10pt/1h @1d", big: { name: "BIG", pts: 100, eff: 6, day: 2 }, small: { name: "small", pts: 10, eff: 1, day: 1 }, want: "BIG" },
  { label: "B  slack:         big 100pt/6h @4d  vs small 10pt/1h @1d", big: { name: "BIG", pts: 100, eff: 6, day: 4 }, small: { name: "small", pts: 10, eff: 1, day: 1 }, want: "small" },
  { label: "C  imminent-fine: big 100pt/2h @2d  vs small 10pt/1h @1d", big: { name: "BIG", pts: 100, eff: 2, day: 2 }, small: { name: "small", pts: 10, eff: 1, day: 1 }, want: "small" },
  { label: "E  heavy crunch:  big 300pt/16h @4d vs small 10pt/1h @1d", big: { name: "BIG", pts: 300, eff: 16, day: 4 }, small: { name: "small", pts: 10, eff: 1, day: 1 }, want: "BIG" },
];

const win = (b: Item, s: Item, pb: number, ps: number) => (value(b.pts, b.day, pb) > value(s.pts, s.day, ps) ? b.name : s.name);
const mk = (w: string, want: string) => `${w}${w === want ? " ✓" : " ✗"}`.padEnd(10);

console.log("case".padEnd(52) + "ρ     fixed-p   days-slide  load-slide");
for (const c of cases) {
  const items = [c.big, c.small];
  const rb = crunch(items, c.big.day), rs = crunch(items, c.small.day);
  const fixed = win(c.big, c.small, 0.40, 0.40);
  const days = win(c.big, c.small, pDays(c.big.day), pDays(c.small.day));
  const load = win(c.big, c.small, pLoad(rb), pLoad(rs));
  console.log(c.label.padEnd(52) + `${rb.toFixed(2)}  ` + mk(fixed, c.want) + mk(days, c.want) + mk(load, c.want));
}
console.log(`\n(ρ>1 = can't finish both in time = crunch.  p_slack=${P_SLACK} deadline-driven … p_crunch=${P_CRUNCH} points-driven)`);
