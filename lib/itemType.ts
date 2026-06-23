// Classify a Canvas assignment into a type bucket. Drives the Calendar TYPE
// glyph AND how far ahead the planner schedules studying (exams get a longer
// lead than quizzes). Pure + unit-tested.
//
// `submissionTypes` is the Canvas assignment-level `submission_types` array
// stored comma-joined (e.g. "online_quiz"); `name` is the fallback heuristic.

export type ItemType = "assignment" | "quiz" | "exam" | "other";

/** Types the planner schedules *study* sessions for, ahead of the due date. */
export function isStudyType(t: ItemType): boolean {
  return t === "exam" || t === "quiz";
}

/** Where an item row should navigate. One source of truth so every list
 *  (dashboard, course page, plan) routes a given item the same way:
 *   - finished work → its detail leaf (you review a grade, you don't study a done test),
 *   - active exams/quizzes → the study flow,
 *   - everything else → the assignment-detail leaf. */
export function itemHref(canvasId: number, type: ItemType, status?: "done" | "overdue" | "normal"): string {
  if (status === "done") return `/assignment/${canvasId}`;
  return isStudyType(type) ? `/study/${canvasId}` : `/assignment/${canvasId}`;
}

// Canvas submission_types that mean the student submits something online.
const ONLINE_SUBMISSION = [
  "online_quiz",
  "online_text_entry",
  "online_upload",
  "online_url",
  "media_recording",
  "student_annotation",
  "discussion_topic",
  "basic_lti_launch",
  "external_tool",
];

/** Does this assignment require an ONLINE submission? `submission_types` of just
 *  "none"/"not_graded" — a teacher-entered grade column — returns false.
 *  ⚠️ A false here means only "no online submission", NOT "nothing to do":
 *  in-person exams AND assigned readings are also "none". Separating a passive
 *  participation grade from an in-person exam / reading needs the AI screen
 *  (see lib/analysis `requiresAction`). */
export function requiresOnlineSubmission(submissionTypes: string | null | undefined): boolean {
  const st = (submissionTypes ?? "").toLowerCase();
  return ONLINE_SUBMISSION.some((t) => st.includes(t));
}

export function itemType(submissionTypes: string | null | undefined, name: string): ItemType {
  const st = (submissionTypes ?? "").toLowerCase();
  const n = (name ?? "").toLowerCase();
  // Exams / midterms / tests (long study lead). "final" only counts as an exam
  // when paired with "exam" so a "final project" stays an assignment.
  if (/\b(exam|midterm|test)\b/.test(n) || /\bfinal\b[\s\S]*\bexam\b/.test(n)) return "exam";
  // Quizzes (short study lead).
  if (st.includes("online_quiz") || /\bquiz\b/.test(n)) return "quiz";
  if (st.includes("discussion_topic") || st.includes("external_tool") || /\bdiscussion\b/.test(n)) return "other";
  return "assignment";
}

// Fixed categorical colors for the four types — used by the Timeline to color bars
// by WHAT the work is (not which class). No pink; exam = red to read as high-stakes,
// assignment = the brand violet (the most common bar). Stable across light/dark.
export const TYPE_COLOR: Record<ItemType, string> = {
  assignment: "#7c5cf0", // violet (brand accent)
  quiz: "#0ea5e9", // sky
  exam: "#ef4444", // red (highest stakes)
  other: "#64748b", // slate (discussions / misc)
};

// One canonical set of human labels for the four item types, used everywhere
// (Timeline legend, assignment detail, dashboard/plan/course rows). Keep these
// compact — they read inline in list rows ("Exam · Microeconomics").
export const TYPE_LABEL: Record<ItemType, string> = {
  assignment: "Assignment",
  quiz: "Quiz",
  exam: "Exam",
  other: "Task",
};
