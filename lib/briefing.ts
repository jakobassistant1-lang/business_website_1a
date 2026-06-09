// AI "daily briefing" via Google Gemini (Flash-Lite). Narration layer ONLY —
// it explains the already-ranked priorities in friendly language; it does not
// compute them (lib/priority.ts does). Server-only: GEMINI_API_KEY never leaves
// the server. Fails OPEN: every path returns a typed result, never throws, so
// the Plan page always renders the full plan + recommendations without it.

import type { ScoredAssignment } from "./priority";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";
const TIMEOUT_MS = 6000;

// Editable from /admin/ai (stored in the Setting table). This is the fallback
// when no custom prompt has been saved.
export const DEFAULT_BRIEFING_INSTRUCTION =
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

/** Shared Gemini call. `fullPrompt` already includes the instruction + data.
 *  Fails open: every path returns a typed BriefingResult, never throws. */
async function runGemini(fullPrompt: string, maxOutputTokens: number): Promise<BriefingResult> {
  const key = geminiKey();
  if (!key) return { ok: false, reason: "no_key" }; // zero network, zero cost

  const body = {
    contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens },
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

export async function generateBriefing(
  input: BriefingInput,
  instruction: string = DEFAULT_BRIEFING_INSTRUCTION,
): Promise<BriefingResult> {
  return runGemini(`${instruction}\n\n${buildPrompt(input)}`, 200);
}

// --- Period study coach (Calendar / Timeline) --------------------------------
// A learning-science "game plan" for a selected period. Advisory only — it
// narrates the already-scheduled, already-ranked work; it never reorders or
// invents deadlines. Admin-tunable (PERIOD_COACH_PROMPT_KEY); fails open.

export const DEFAULT_PERIOD_COACH_INSTRUCTION =
  "You are StudyPlan's study coach. You are given a student's workload for a specific period " +
  "(today, this week, or this month) plus their top priorities, which our system has ALREADY ranked " +
  "and scheduled to be deadline-safe. Each item is tagged with a type in [brackets]. Write a warm, " +
  "practical game plan of 2-5 short sentences using evidence-based techniques MATCHED TO THE WORK:\n" +
  "- For [exam] and [quiz] items: recommend retrieval practice / active recall (self-testing, " +
  "flashcards, practice problems) and spaced review starting a few days ahead — not re-reading.\n" +
  "- For [assignment] and [other] items (labs, essays, projects, problem sets): recommend breaking the " +
  "task into steps, starting early, and focused work blocks. Do NOT suggest active recall or flashcards " +
  "for these — that advice only fits studying for a test.\n" +
  "Across everything, you may suggest interleaving subjects, short breaks, and doing the hardest work " +
  "when energy is freshest. Tie advice to their ACTUAL items and deadlines. Never invent assignments, " +
  "points, or due dates beyond what is given, and never suggest doing something after its due date. " +
  "Plain English. No markdown, no lists, no headings.";

export interface PeriodTopItem {
  name: string;
  courseName: string;
  dueLabel: string;
  effort: string | null; // e.g. "2h", "quick"
  type: string; // assignment | quiz | exam | other — lets the coach tailor technique advice
}

export interface PeriodBriefingInput {
  firstName: string;
  period: "day" | "week" | "month";
  rangeLabel: string; // "today", "Jun 9–15", "June 2026"
  dueCount: number;
  atRiskCount: number;
  busyHours: number; // calendar busy hours within the period
  top: PeriodTopItem[];
}

export function buildPeriodPrompt(input: PeriodBriefingInput): string {
  const lines: string[] = [];
  lines.push(`Student: ${input.firstName || "there"}. Period: ${input.period} (${input.rangeLabel}).`);
  lines.push(
    `Items due in this period: ${input.dueCount}. At risk: ${input.atRiskCount}. ` +
      `Calendar busy hours in the period: ${Math.round(input.busyHours)}.`,
  );
  if (input.top.length) {
    lines.push("Priorities (already ranked + scheduled deadline-safe by our system, most urgent first):");
    input.top.forEach((t, i) => {
      lines.push(`${i + 1}. ${t.name} (${t.courseName}) [${t.type}] — due ${t.dueLabel}${t.effort ? `, ~${t.effort}` : ""}`);
    });
  } else {
    lines.push("Nothing is due in this period.");
  }
  lines.push("Write the study-coach game plan for this period.");
  return lines.join("\n");
}

export async function generatePeriodBriefing(
  input: PeriodBriefingInput,
  instruction: string = DEFAULT_PERIOD_COACH_INSTRUCTION,
): Promise<BriefingResult> {
  return runGemini(`${instruction}\n\n${buildPeriodPrompt(input)}`, 320);
}

// --- Per-assignment description (shown when an item is opened) ----------------

export interface AssignmentDescInput {
  name: string;
  courseName: string;
  type: string; // assignment | quiz | exam | other
  points: number | null;
  dueLabel: string | null;
}

export function buildDescriptionPrompt(i: AssignmentDescInput): string {
  const bits = [`Assignment: "${i.name}" in ${i.courseName}.`, `Type: ${i.type}.`];
  if (i.points != null) bits.push(`Worth ${i.points} points.`);
  if (i.dueLabel) bits.push(`Due ${i.dueLabel}.`);
  return (
    bits.join(" ") +
    "\nIn ONE plain-English sentence, describe what this assignment most likely involves and how a " +
    "student should approach it. Be concrete but do NOT invent specific page numbers, prompts, or " +
    "requirements you cannot know from the title. No preamble, no markdown."
  );
}

export async function generateAssignmentDescription(input: AssignmentDescInput): Promise<BriefingResult> {
  return runGemini(buildDescriptionPrompt(input), 120);
}
