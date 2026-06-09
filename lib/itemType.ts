// Classify a Canvas assignment into a small type bucket for the Calendar's TYPE
// glyph (assignment vs quiz/test vs other). Pure + unit-tested.
//
// `submissionTypes` is the Canvas assignment-level `submission_types` array
// stored comma-joined (e.g. "online_quiz"); `name` is a fallback heuristic for
// when Canvas doesn't tag the type but the title makes it obvious.

export type ItemType = "assignment" | "quiz" | "other";

export function itemType(submissionTypes: string | null | undefined, name: string): ItemType {
  const st = (submissionTypes ?? "").toLowerCase();
  const n = (name ?? "").toLowerCase();
  if (st.includes("online_quiz") || /\b(quiz|exam|midterm|final|test)\b/.test(n)) return "quiz";
  if (st.includes("discussion_topic") || st.includes("external_tool") || /\bdiscussion\b/.test(n)) return "other";
  return "assignment";
}
