// A code-constructed particle wave filling the bottom-right of every page with a
// barely-there violet — ambient visual filler, never an attention-grabber. Fully
// deterministic (index + sine math, no randomness) so it's SSR/hydration-safe,
// and computed once at module load. Sits behind all content (-z-10), inert.

const W = 820;
const H = 600;
const STEP = 13;
const MAX_OPACITY = 0.3; // peak per-dot alpha — visible but still a soft background
// A saturated purple reads as purple even when faint; the theme's blue-violet
// accent desaturates to grey at low opacity over the cream page.
const WAVE_COLOR = "#9333ea";

type Dot = { x: number; y: number; r: number; o: number };

function buildDots(): Dot[] {
  const dots: Dot[] = [];
  for (let x = 0; x <= W; x += STEP) {
    for (let y = 0; y <= H; y += STEP) {
      // Flowing wave bands: horizontal contours warped into waves by x and y.
      const warp = 52 * Math.sin(x * 0.012) + 26 * Math.sin(x * 0.03 + y * 0.016) + 16 * Math.sin(y * 0.02);
      const band = Math.sin((y + warp) * 0.05);
      let v = (band + 1) / 2; // 0..1
      v = Math.pow(v, 2.2); // sharpen so dots cluster along the crests, sparse between
      // Anchor to the bottom-right corner; dissolve toward the top-left.
      const fade = Math.max(0, Math.min(1, x / W + y / H - 0.45));
      const o = v * fade * MAX_OPACITY;
      if (o > 0.012) dots.push({ x, y, r: +(0.8 + v).toFixed(2), o: +o.toFixed(3) });
    }
  }
  return dots;
}

const DOTS = buildDots();

export function WaveBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed bottom-0 right-0 -z-10 h-[600px] w-[820px] max-w-full overflow-hidden">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMaxYMax meet" className="h-full w-full">
        <g fill={WAVE_COLOR}>
          {DOTS.map((d, i) => (
            <circle key={i} cx={d.x} cy={d.y} r={d.r} opacity={d.o} />
          ))}
        </g>
      </svg>
    </div>
  );
}
