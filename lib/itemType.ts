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
