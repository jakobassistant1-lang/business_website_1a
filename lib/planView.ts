// Which Plan view to show (ticket #39). Pure, so it's unit-tested without a DOM.
//
// Phones (below `md`) always get the List (agenda) — Calendar Week/Month and the
// Timeline Gantt are desktop/tablet views by design (docs/mobile-ux-plan.md §4).
// The saved preference (`sp_plan_view`) is only APPLIED on tablet/desktop; it is
// never overwritten on a phone, so it's still there when the student opens a
// laptop.

export type PlanViewKey = "list" | "calendar" | "timeline";

/** The view before any preference is known (and for an unrecognised saved value). */
export const DEFAULT_PLAN_VIEW: PlanViewKey = "calendar";

export function isPlanView(v: unknown): v is PlanViewKey {
  return v === "list" || v === "calendar" || v === "timeline";
}

/** `saved` = the stored preference (or the current in-session pick); `isPhone` =
 *  below the `md` breakpoint, or `null` while the width isn't known yet (server
 *  render / first client frame). Unknown width → `null`: the caller renders a
 *  placeholder rather than guess, so a phone never mounts the Calendar/Timeline
 *  (whose mount effects start a sync and a briefing fetch) even for one frame. */
export function resolvePlanView(saved: string | null | undefined, isPhone: boolean | null): PlanViewKey | null {
  if (isPhone === null) return null;
  if (isPhone) return "list";
  return isPlanView(saved) ? saved : DEFAULT_PLAN_VIEW;
}
