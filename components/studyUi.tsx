// Small shared presentational bits for the Study hub (/study) and the per-test
// tools page (/study/[canvasId]). Client-safe, no hooks.

import { fmtTime } from "@/components/calendar/parts";
import { WEEKDAYS, MONTHS_SHORT, parseYmd } from "@/lib/calendarDates";
import type { ItemType } from "@/lib/itemType";

export const TYPE_LABEL: Record<ItemType, string> = { assignment: "Assignment", quiz: "Quiz", exam: "Exam", other: "Task" };
export const shortCourse = (name: string) => name.split(" · ")[0];

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
