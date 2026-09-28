// Small shared presentational bits for the Study hub (/study) and the per-test
// tools page (/study/[canvasId]). Client-safe, no hooks. Due dates are NOT
// formatted here: both pages print them with components/DueLabel ("long-time"),
// the one zone-aware formatter (#140).

import { WEEKDAYS, MONTHS_SHORT, parseYmd } from "@/lib/calendarDates";

// Re-exported from the canonical sources so the Study pages share one definition
// of these with the rest of the app (no drift).
export { TYPE_LABEL } from "@/lib/itemType";
export { shortCourse } from "@/lib/courseName";

/** A plan session's calendar day ("YYYY-MM-DD", zone-free) in words. */
export function sessionDateLabel(ymdStr: string): string {
  const d = parseYmd(ymdStr);
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

/** Chip for the violet hero cards. Text is `accent-on` (white in light mode, near
 *  black in dark) on the `accent-hover` step, which is darker than the card in light
 *  mode and lighter in dark, so the chip text clears 4.5:1 in both themes. */
export function StudyChip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-accent-hover px-2.5 py-1 text-xs font-medium text-accent-on ring-1 ring-inset ring-accent-on/25">{children}</span>;
}

/** Key for the Study hub's session-cached coach line: a short hash of everything
 *  the line is written from (the day, how many tests, and the top five tests with
 *  their due instants). A new test, a moved date or a new day gets a new key. */
export function studyCoachCacheKey(todayYmd: string, tests: { canvasId: number; dueAt: string | null }[]): string {
  const sig = [todayYmd, tests.length, ...tests.slice(0, 5).map((t) => `${t.canvasId}@${t.dueAt ?? ""}`)].join("|");
  let h = 5381;
  for (let i = 0; i < sig.length; i++) h = ((h << 5) + h + sig.charCodeAt(i)) | 0;
  return `navo:study-coach:${(h >>> 0).toString(36)}`;
}

/** The viewer's IANA time zone, sent to the AI routes so "today" and due days in
 *  prompts match the student's calendar (#140). Client-only; "" if unavailable
 *  (the routes then fall back to UTC). */
export function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

/** Small drawn icons for the Study pages' links (no unicode arrows). */
export function ChevronIcon({ dir = "right", className }: { dir?: "left" | "right"; className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true" className={className}>
      <path d={dir === "right" ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
export function ExternalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M7 17L17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
