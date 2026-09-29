// The ONE place effort hours become text (single-source rule): sub-hour always
// reads as minutes, never a decimal of an hour (Calvin). Server-safe — imported
// by client components (via components/calendar/parts) AND API routes (briefing).

import { MIN_BLOCK } from "./effort";

/** Hours → friendly label: sub-hour shows minutes (so the 20-min study floor
 *  reads as "20m"), otherwise "Nh". Rounds minutes to the nearest 5. The input is
 *  first snapped to the plan's 0.01h precision (lib/effort.roundHours), so a sum
 *  of blocks carrying float noise (4.9499999…) prints exactly like the 4.95 tag
 *  it adds up to (#136: tag and block total must read the same). Below MIN_BLOCK
 *  (3 min — no block is scheduled for it either) it is "" — never "0m". */
export function fmtHours(h: number): string {
  const cents = Math.round(h * 100);
  if (!(cents >= Math.round(MIN_BLOCK * 100))) return "";
  const mins = Math.round((cents * 60) / 500) * 5;
  return mins < 60 ? `${mins}m` : `${Math.round(cents / 10) / 10}h`;
}

/** "~2h" / "~30m" from a total estimate; null when there's no usable number.
 *  Routes through fmtHours so anything under an hour reads as minutes (never a
 *  decimal of an hour) — consistent with the preset chips in EffortEditor. */
export function effortHoursText(hours: number | null | undefined): string | null {
  if (hours == null) return null;
  const text = fmtHours(hours);
  return text ? `~${text}` : null; // under MIN_BLOCK: no tag, just as there's no block
}
