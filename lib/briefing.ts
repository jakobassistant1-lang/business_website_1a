// AI "daily briefing" via Google Gemini (Flash-Lite). Narration layer ONLY —
// it explains the already-ranked priorities in friendly language; it does not
// compute them (lib/priority.ts does). Server-only: GEMINI_API_KEY never leaves
// the server. Fails OPEN: every path returns a typed result, never throws, so
// the Plan page always renders the full plan + recommendations without it.

import type { ScoredAssignment } from "./priority";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";
const TIMEOUT_MS = 6000;

const INSTRUCTION =
  "You are StudyPlan's study coach. Given the student's plan summary and their top priorities, " +
  "write a warm, plain-English briefing of 2-4 short sentences telling them what to focus on today and why. " +
  "Do not invent assignments, points, or deadlines beyond what is given. No markdown, no lists, no headings.";

export interface BriefingInput {
  firstName: string;
  windowDays: number;
  inWindowDueCount: number;
  atRiskCount: number;
  top: ScoredAssignment[]; // already ranked, top N
}

export type BriefingResult =
  | { ok: true; text: string; source: "gemini" }
  | { ok: false; reason: "no_key" | "timeout" | "http_error" | "bad_response" | "empty" };

/** Compact, deterministic data summary handed to the model (unit-tested). */
export function buildPrompt(input: BriefingInput): string {
  const lines: string[] = [];
  lines.push(
    `Student: ${input.firstName || "there"}. Window: ${input.windowDays} days. ` +
      `Due in window: ${input.inWindowDueCount}, at risk: ${input.atRiskCount}.`,
  );
  if (input.top.length) {
    lines.push("Top priorities (already ranked by our system):");
    input.top.forEach((t, i) => {
      lines.push(`${i + 1}. ${t.name} (${t.courseName})${t.reason ? ` — ${t.reason}` : ""}`);
    });
  } else {
    lines.push("No outstanding priorities.");
  }
  lines.push("Write the briefing.");
  return lines.join("\n");
}

/** Pull the text out of a Gemini generateContent response, guarding every level. */
export function parseGeminiText(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cand = (json as any).candidates?.[0];
  const parts = cand?.content?.parts;
  if (!Array.isArray(parts)) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("").trim();
  return text.length ? text : null;
}

// Env var names are case-sensitive; tolerate a mis-cased key (e.g. a dashboard
// typo like "Gemini_API_Key") so the feature isn't silently disabled.
function geminiKey(): string | undefined {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const hit = Object.entries(process.env).find(([k]) => k.toLowerCase() === "gemini_api_key");
  return hit?.[1] || undefined;
}

export async function generateBriefing(input: BriefingInput): Promise<BriefingResult> {
  const key = geminiKey();
  if (!key) return { ok: false, reason: "no_key" }; // zero network, zero cost

  const body = {
    contents: [{ role: "user", parts: [{ text: `${INSTRUCTION}\n\n${buildPrompt(input)}` }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 200 },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, reason: "http_error" };
    const json = await res.json().catch(() => null);
    const text = parseGeminiText(json);
    if (text === null) return { ok: false, reason: "bad_response" };
    if (!text.trim()) return { ok: false, reason: "empty" };
    return { ok: true, text: text.trim(), source: "gemini" };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return { ok: false, reason: "timeout" };
    return { ok: false, reason: "http_error" };
  } finally {
    clearTimeout(timer);
  }
}
