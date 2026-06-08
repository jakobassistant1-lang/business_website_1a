import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin";
import { getSetting, setSetting, ANALYSIS_PROMPT_KEY } from "@/lib/settings";
import { DEFAULT_ANALYSIS_INSTRUCTION } from "@/lib/analysis";

const MAX = 4000;

export const GET = withAdmin(async () => {
  const saved = await getSetting(ANALYSIS_PROMPT_KEY);
  return NextResponse.json({
    prompt: saved ?? DEFAULT_ANALYSIS_INSTRUCTION,
    isCustom: saved !== null,
    default: DEFAULT_ANALYSIS_INSTRUCTION,
  });
});

export const PUT = withAdmin(async (_admin, req) => {
  const body = await req.json().catch(() => ({}));
  const prompt = String(body.prompt ?? "").trim();
  if (!prompt) return NextResponse.json({ error: "The prompt can't be empty." }, { status: 400 });
  if (prompt.length > MAX) return NextResponse.json({ error: `Keep it under ${MAX} characters.` }, { status: 400 });
  await setSetting(ANALYSIS_PROMPT_KEY, prompt);
  return NextResponse.json({ ok: true });
});
