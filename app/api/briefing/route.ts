import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { requireUser } from "@/lib/auth";
import { loadPlan } from "@/lib/plan";
import { generateBriefing, DEFAULT_BRIEFING_INSTRUCTION } from "@/lib/briefing";
import { getSetting, BRIEFING_PROMPT_KEY } from "@/lib/settings";

export const dynamic = "force-dynamic";

// Best-effort in-process cache (per warm serverless instance) so we don't call
// Gemini on every page load / no-op hours toggle. TTL- and size-bounded.
const CACHE = new Map<string, { text: string; at: number }>();
const TTL_MS = 30 * 60_000;
const MAX = 200;

function cacheGet(key: string): string | null {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    CACHE.delete(key);
    return null;
  }
  return hit.text;
}
function cacheSet(key: string, text: string) {
  if (CACHE.size >= MAX) {
    const oldest = CACHE.keys().next().value;
    if (oldest) CACHE.delete(oldest);
  }
  CACHE.set(key, { text, at: Date.now() });
}

// GET /api/briefing?hours= — AI narration of the plan's top priorities. Always
// returns `recommendations` (the deterministic logic); `text` is null whenever
// the AI is unavailable, so the UI degrades gracefully.
export async function GET(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const hoursRaw = new URL(req.url).searchParams.get("hours");
  const hoursNum = hoursRaw !== null ? Number(hoursRaw) : undefined;
  const hours =
    hoursNum !== undefined && Number.isFinite(hoursNum) && hoursNum > 0 && hoursNum <= 24 ? hoursNum : undefined;

  const payload = await loadPlan(user.id, hours);
  const top = payload.recommendations;

  // Nothing to brief → skip the AI call entirely.
  if (top.length === 0) {
    return NextResponse.json({ ok: false, text: null, reason: "empty_plan", recommendations: [] });
  }

  const atRiskCount = payload.plan.atRisk.length;
  const instruction = (await getSetting(BRIEFING_PROMPT_KEY)) || DEFAULT_BRIEFING_INSTRUCTION;
  const sig = JSON.stringify({
    u: user.id,
    w: payload.windowDays,
    h: payload.hours,
    d: payload.plan.inWindowDueCount,
    r: atRiskCount,
    p: instruction, // a prompt change must bust the cache
    t: top.map((t) => `${t.canvasId}:${t.score}:${t.reason}`),
  });
  const key = createHash("sha1").update(sig).digest("hex");

  const cached = cacheGet(key);
  if (cached) return NextResponse.json({ ok: true, text: cached, recommendations: top, cached: true });

  const result = await generateBriefing(
    {
      firstName: user.fullName.trim().split(/\s+/)[0] ?? "",
      windowDays: payload.windowDays,
      inWindowDueCount: payload.plan.inWindowDueCount,
      atRiskCount,
      top,
    },
    instruction,
  );

  if (result.ok) cacheSet(key, result.text);
  else console.warn(`[briefing] gemini unavailable: ${result.reason}`); // reason only, never the key
  return NextResponse.json({
    ok: result.ok,
    text: result.ok ? result.text : null,
    reason: result.ok ? undefined : result.reason,
    recommendations: top, // always present — AI failure never hides the logic
  });
}
