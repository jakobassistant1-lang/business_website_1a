import { prisma } from "./prisma";

// Global key/value app settings. Currently used for the editable Gemini
// briefing prompt so the owner can tune it from /admin/ai without a redeploy.
export const BRIEFING_PROMPT_KEY = "briefing_prompt";
export const ANALYSIS_PROMPT_KEY = "analysis_prompt";
export const PERIOD_COACH_PROMPT_KEY = "period_coach_prompt";
// Study-output prompts (the "Study outputs" group on /admin/ai).
export const STUDY_PROMPT_KEYS = {
  plan: "study_plan_prompt",
  guide: "study_guide_prompt",
  questions: "study_questions_prompt",
} as const;
export type StudyPromptKind = keyof typeof STUDY_PROMPT_KEYS;

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}
