import { prisma } from "./prisma";

// Global key/value app settings. Currently used for the editable Gemini
// briefing prompt so the owner can tune it from /admin/ai without a redeploy.
export const BRIEFING_PROMPT_KEY = "briefing_prompt";
export const ANALYSIS_PROMPT_KEY = "analysis_prompt";

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
