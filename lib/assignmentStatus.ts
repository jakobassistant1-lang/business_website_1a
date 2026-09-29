// The ONE definition of "done" for an assignment (single-source rule) — shared
// by lib/calendarData, lib/plan and the assignment page so every surface splits
// active/completed the same way. Done, in this order (the first match is the
// reason — CalendarItem.doneReason):
//   • "manual"      — the student checked it off (manualDoneAt — their word is
//                     final until THEY uncheck it; a sync or reopen never clears it);
//   • "graded"      — Canvas says the submission is graded, even with no submission
//                     time (a graded in-class exam used to sit in Upcoming forever);
//   • "submitted"   — a submission timestamp AND Canvas hasn't reset it: when an
//                     instructor reopens a submission, Canvas keeps the old
//                     submitted_at but flips workflow_state to "unsubmitted" — such
//                     rows stay active;
//   • "date_passed" — an exam or quiz whose due DAY has passed in the student's zone
//                     (owner, 2026-09-28: "once an exam/quiz date passes, it should
//                     automatically be moved to done"). Needs `ctx`; without it this
//                     clause is skipped. NOT for a reopened submission (submittedAt
//                     set + "unsubmitted"): the teacher reopened it, so it stays active.

import { isStudyType, type ItemType } from "./itemType";
import { dayDiffInZone } from "./studentZone";

export type DoneReason = "manual" | "graded" | "submitted" | "date_passed";

export interface DoneRow {
  manualDoneAt?: Date | null;
  submittedAt: Date | null;
  submissionState: string | null;
  dueAt?: Date | string | null;
}

/** What the date clause needs: the item's type, its due instant (defaults to the
 *  row's `dueAt`), the student's zone (lib/studentZone.studentZone) and now. */
export interface DoneCtx {
  type: ItemType;
  dueAt?: Date | string | null;
  zone: string;
  now: Date;
}

/** Why this row counts as done, or null when it is still active. THE rule. */
export function assignmentDoneReason(a: DoneRow, ctx?: DoneCtx): DoneReason | null {
  if (a.manualDoneAt != null) return "manual";
  if (a.submissionState === "graded") return "graded";
  if (a.submittedAt !== null && a.submissionState !== "unsubmitted") return "submitted";
  const reopened = a.submittedAt !== null && a.submissionState === "unsubmitted";
  if (ctx && isStudyType(ctx.type) && !reopened) {
    const due = ctx.dueAt !== undefined ? ctx.dueAt : (a.dueAt ?? null);
    if (due != null && dayDiffInZone(due, ctx.zone, ctx.now) < 0) return "date_passed";
  }
  return null;
}

export function isAssignmentDone(a: DoneRow, ctx?: DoneCtx): boolean {
  return assignmentDoneReason(a, ctx) !== null;
}
