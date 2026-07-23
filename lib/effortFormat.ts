// The ONE place effort hours become text (single-source rule): sub-hour always
// reads as minutes, never a decimal of an hour (Calvin). Server-safe — imported
// by client components (via components/calendar/parts) AND API routes (briefing).

/** Hours → friendly label: sub-hour shows minutes (so the 20-min study floor
 *  reads as "20m"), otherwise "Nh". Rounds minutes to the nearest 5. */
export function fmtHours(h: number): string {
  if (h <= 0) return "0m";
  const mins = Math.round((h * 60) / 5) * 5;
  return mins < 60 ? `${mins}m` : `${Math.round(h * 10) / 10}h`;
}

/** "~2h" / "~30m" from a total estimate; null when there's no usable number.
 *  Routes through fmtHours so anything under an hour reads as minutes (never a
 *  decimal of an hour) — consistent with the preset chips in EffortEditor. */
export function effortHoursText(hours: number | null | undefined): string | null {
  if (hours == null || hours <= 0) return null;
  return `~${fmtHours(hours)}`;
}
