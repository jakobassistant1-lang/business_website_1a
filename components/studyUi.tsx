// Small shared presentational bits for the Study hub (/study) and the per-test
// tools page (/study/[canvasId]). Client-safe, no hooks.

import { fmtTime } from "@/components/calendar/parts";
import { WEEKDAYS, MONTHS_SHORT, parseYmd } from "@/lib/calendarDates";

// Re-exported from the canonical sources so the Study pages share one definition
// of these with the rest of the app (no drift).
export { TYPE_LABEL } from "@/lib/itemType";
export { shortCourse } from "@/lib/courseName";

export function dueLabel(iso: string): string {
  const d = new Date(iso);
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()} · ${fmtTime(iso)}`;
}
export function sessionDateLabel(ymdStr: string): string {
  const d = parseYmd(ymdStr);
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

/** White-on-violet chip for the hero cards. */
export function StudyChip({ text }: { text: string }) {
  return <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium text-white ring-1 ring-inset ring-white/25">{text}</span>;
}
