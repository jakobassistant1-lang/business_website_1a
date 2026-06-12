// Client-safe study-page shared bits: content shapes, question types, and the
// deterministic short-answer grader. NO node/server imports — this file is
// bundled into the browser (StudyView) AND re-exported by lib/study.ts for the
// server side, so the two can never drift.

export const QUESTION_TYPES = [
  { id: "multiple_choice", label: "Multiple choice" },
  { id: "true_false", label: "True / false" },
  { id: "short_answer", label: "Short answer" },
] as const;
export type StudyQuestionType = (typeof QUESTION_TYPES)[number]["id"];
export function isQuestionType(v: unknown): v is StudyQuestionType {
  return QUESTION_TYPES.some((t) => t.id === v);
}

export interface PlanSession {
  date: string; // YYYY-MM-DD — always one of the scheduler's block dates
  hours: number;
  focus: string;
  techniques: string[];
  activities: string[];
}
export interface StudyPlanContent {
  advice: string;
  sessions: PlanSession[];
}

export interface GuideSection {
  title: string;
  points: string[];
  terms: { term: string; def: string }[];
}
export interface StudyGuideContent {
  overview: string;
  sections: GuideSection[];
  sparse: boolean;
  sources: string[]; // human-readable source titles, for the "based on" note
}

export type StudyQuestion =
  | { kind: "multiple_choice"; prompt: string; choices: string[]; answer: number; explanation: string }
  | { kind: "true_false"; prompt: string; answer: boolean; explanation: string }
  | { kind: "short_answer"; prompt: string; acceptable: string[]; modelAnswer: string; explanation: string };
export interface StudyQuestionsContent {
  type: StudyQuestionType;
  questions: StudyQuestion[];
  sparse: boolean;
  sources: string[];
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Short-answer grading — deterministic, zero extra model calls. Correct when any
 *  acceptable phrase appears in the answer, or all of a phrase's words do. */
export function gradeShortAnswer(answer: string, acceptable: string[]): boolean {
  const a = norm(answer);
  if (!a) return false;
  const aTokens = new Set(a.split(" "));
  return acceptable.some((acc) => {
    const p = norm(acc);
    if (!p) return false;
    if (a.includes(p)) return true;
    const words = p.split(" ");
    return words.length > 1 && words.every((w) => aTokens.has(w));
  });
}
