// Pure helpers for the phone Courses carousel (components/CourseCarousel.tsx).
// Kept out of the component so the "which card is centered" maths is unit-tested.

/**
 * Index of the slide whose centre is closest to the centre of the visible
 * scroller window. `slideOffsets` are each slide's CENTRE x-position inside the
 * scroll content (offsetLeft + offsetWidth / 2); `viewportWidth` is the
 * scroller's clientWidth. Ties go to the earlier slide; no slides → 0.
 */
export function nearestIndex(scrollLeft: number, slideOffsets: number[], viewportWidth: number): number {
  const center = scrollLeft + viewportWidth / 2;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < slideOffsets.length; i++) {
    const d = Math.abs(slideOffsets[i] - center);
    if (d < bestDist) {
      best = i;
      bestDist = d;
    }
  }
  return best;
}

/** Accessible name for dot / slide `i` (0-based) of `n`: "Course 1 of 5". */
export function dotLabel(i: number, n: number): string {
  return `Course ${i + 1} of ${n}`;
}
