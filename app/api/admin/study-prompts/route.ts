import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin";
import { getSetting, setSetting, STUDY_PROMPT_KEYS, type StudyPromptKind } from "@/lib/settings";
import {
  DEFAULT_STUDY_PLAN_INSTRUCTION,
  DEFAULT_STUDY_GUIDE_INSTRUCTION,
  DEFAULT_STUDY_QUESTIONS_INSTRUCTION,
} from "@/lib/study";

const MAX = 4000;
const DEFAULTS: Record<StudyPromptKind, string> = {
  plan: DEFAULT_STUDY_PLAN_INSTRUCTION,
  guide: DEFAULT_STUDY_GUIDE_INSTRUCTION,
  questions: DEFAULT_STUDY_QUESTIONS_INSTRUCTION,
};
const isKind = (v: unknown): v is StudyPromptKind => v === "plan" || v === "guide" || v === "questions";

// GET — all three study prompts (saved, or the built-in default each).
export const GET = withAdmin(async () => {
  const out: Record<string, { prompt: string; isCustom: boolean; default: string }> = {};
  for (const kind of Object.keys(STUDY_PROMPT_KEYS) as StudyPromptKind[]) {
    const saved = await getSetting(STUDY_PROMPT_KEYS[kind]);
    out[kind] = { prompt: saved ?? DEFAULTS[kind], isCustom: saved !== null, default: DEFAULTS[kind] };
  }
  return NextResponse.json({ prompts: out });
});

// PUT — save one of the three ({ kind, prompt }). Cached generations revalidate
// automatically: the prompt text is part of each generation's inputHash.
export const PUT = withAdmin(async (_admin, req) => {
  const body = await req.json().catch(() => ({}));
  const kind: unknown = body.kind;
  if (!isKind(kind)) return NextResponse.json({ error: "Unknown prompt." }, { status: 400 });
  const prompt = String(body.prompt ?? "").trim();
  if (!prompt) return NextResponse.json({ error: "The prompt can't be empty." }, { status: 400 });
  if (prompt.length > MAX) return NextResponse.json({ error: `Keep it under ${MAX} characters.` }, { status: 400 });
  await setSetting(STUDY_PROMPT_KEYS[kind], prompt);
  return NextResponse.json({ ok: true });
});
