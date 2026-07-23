// The ONE definition of "done" for an assignment (single-source rule) — shared
// by lib/calendarData and lib/plan so every surface splits active/completed the
// same way. Done =
//   • the student manually checked it off (manualDoneAt — their word is final
//     until THEY uncheck it; a Canvas sync or instructor reopen never clears it), OR
//   • it has a submission timestamp AND Canvas hasn't reset it: when an
//     instructor reopens a submission, Canvas keeps the old submitted_at but
//     flips workflow_state to "unsubmitted" — such rows must stay active.
export function isAssignmentDone(a: {
  manualDoneAt?: Date | null;
  submittedAt: Date | null;
  submissionState: string | null;
}): boolean {
  return a.manualDoneAt != null || (a.submittedAt !== null && a.submissionState !== "unsubmitted");
}
