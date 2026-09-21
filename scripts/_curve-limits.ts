// "Is it a due-date engine?" — for the hybrid curve, compute the BREAK-EVEN point
// ratio in the 0-4 day range: how many times bigger a LATER assignment must be to
// beat a SOONER one. value = leverage * weight^p * capture, so at break-even
//   (w_later / w_sooner) = [ (lev_s/lev_l) * (cap_s/cap_l) ] ^ (1/p).
// Finite ratio => weight can still win (not a pure deadline sorter). Lower p => points
// weaker => bigger ratio needed => more deadline-driven.
const LAMBDA = 0.02;
const HYBRID: [number, number][] = [[0, 1], [1, 0.64], [2, 0.42], [3, 0.28], [4, 0.19], [5, 0.155], [6, 0.13], [7, 0.11], [9, 0.085], [11, 0.067], [14, 0.048], [18, 0.032], [24, 0.016], [32, 0.007], [45, 0]];
function lerp(curve: [number, number][], x: number): number {
  if (x <= curve[0][0]) return curve[0][1];
  const last = curve[curve.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < curve.length; i++) { const [x0, y0] = curve[i - 1], [x1, y1] = curve[i]; if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); }
  return last[1];
}
const cap = (d: number) => LAMBDA + (1 - LAMBDA) * lerp(HYBRID, d);
// levRatio = lev_sooner / lev_later (1 = same class)
const R = (p: number, sooner: number, later: number, levRatio = 1) => Math.pow((levRatio * cap(sooner)) / cap(later), 1 / p);

const days = [0, 1, 2, 3, 4];
for (const p of [0.28, 0.35, 0.45]) {
  console.log(`\n=== p=${p} — a LATER assignment must be N× bigger to beat a SOONER one (same class) ===`);
  console.log("sooner ↓ / later →" + days.slice(1).map((d) => `+${d}d`.padStart(9)).join(""));
  for (const s of days.slice(0, 4)) {
    let line = `due in ${s}d`.padEnd(18);
    for (const l of days.slice(1)) line += (l > s ? R(p, s, l).toFixed(1) + "×" : "·").padStart(9);
    console.log(line);
  }
}

console.log(`\n=== concrete @ p=0.28: a 25-pt thing due TODAY is only beaten by ... ===`);
for (const l of [1, 2, 3, 4]) console.log(`   a thing due in ${l}d worth ≥ ${Math.round(25 * R(0.28, 0, l))} pts  (${R(0.28, 0, l).toFixed(0)}×)`);

console.log(`\n=== leverage shifts it (p=0.28, due-today vs due-in-2d) ===`);
console.log(`   same class:                    later needs ${R(0.28, 0, 2).toFixed(0)}×`);
console.log(`   today's item in a WORSE class (2× leverage): later needs ${R(0.28, 0, 2, 2).toFixed(0)}×  (nearly unbeatable)`);
console.log(`   today's item in a BETTER class (½ leverage): later needs ${R(0.28, 0, 2, 0.5).toFixed(0)}×`);

console.log(`\n=== same table @ p=0.28 but for 1-day gaps deeper in the week (sanity: stays ~constant?) ===`);
for (const s of [0, 1, 2, 3, 5, 7]) console.log(`   ${s}d vs ${s + 1}d: later needs ${R(0.28, s, s + 1).toFixed(1)}×`);
