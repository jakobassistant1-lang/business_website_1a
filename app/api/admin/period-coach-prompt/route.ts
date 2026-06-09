import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin";
import { getSetting, setSetting, PERIOD_COACH_PROMPT_KEY } from "@/lib/settings";
import { DEFAULT_PERIOD_COACH_INSTRUCTION } from "@/lib/briefing";

const MAX = 4000;

// GET — current prompt (saved, or the built-in default).
export const GET = withAdmin(async () => {
  const saved = await getSetting(PERIOD_COACH_PROMPT_KEY);
  return NextResponse.json({
    prompt: saved ?? DEFAULT_PERIOD_COACH_INSTRUCTION,
    isCustom: saved !== null,
    default: DEFAULT_PERIOD_COACH_INSTRUCTION,
  });
});

// PUT — save a new prompt.
export const PUT = withAdmin(async (_admin, req) => {
  const body = await req.json().catch(() => ({}));
  const prompt = String(body.prompt ?? "").trim();
  if (!prompt) return NextResponse.json({ error: "The prompt can't be empty." }, { status: 400 });
  if (prompt.length > MAX) return NextResponse.json({ error: `Keep it under ${MAX} characters.` }, { status: 400 });
  await setSetting(PERIOD_COACH_PROMPT_KEY, prompt);
  return NextResponse.json({ ok: true });
});
