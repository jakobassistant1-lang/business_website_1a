/** Round to 1 decimal place — the app's standard display granularity for hours. */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
