// AI "daily briefing" via Google Gemini (Flash-Lite). Narration layer ONLY —
// it explains the already-ranked priorities in friendly language; it does not
// compute them (lib/priority.ts does). Server-only: GEMINI_API_KEY never leaves
// the server. Fails OPEN: every path returns a typed result, never throws, so
// the Plan page always renders the full plan + recommendations without it.

import type { ScoredAssignment } from "./priority";
import { deterministicIntensity, type Intensity, type WeekLoad } from "./intensity";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";
const TIMEOUT_MS = 6000;
const MAX_ATTEMPTS = 3; // Flash-Lite free-tier 429 (rate limit) / 503 (demand) are usually transient.
const RETRYABLE = new Set([429, 503]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Editable from /admin/ai (stored in the Setting table). This is the fallback
// when no custom prompt has been saved.
export const DEFAULT_BRIEFING_INSTRUCTION =
  "You are Navo's study coach. Given the student's plan summary and their top priorities, " +
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
async function runGemini(fullPrompt: string, maxOutputTokens: number, json = false): Promise<BriefingResult> {
  const key = geminiKey();
  if (!key) return { ok: false, reason: "no_key" }; // zero network, zero cost

  const body = {
    contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens, ...(json ? { responseMimeType: "application/json" } : {}) },
  };

  // Retry transient rate-limit (429) / high-demand (503) / timeouts with a short
  // exponential backoff. A hard quota or a non-retryable error still falls open.
  let reason: "timeout" | "http_error" | "bad_response" | "empty" = "http_error";
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(600 * 2 ** (attempt - 1)); // 600ms, then 1200ms
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        reason = "http_error";
        if (RETRYABLE.has(res.status) && attempt < MAX_ATTEMPTS - 1) continue;
        return { ok: false, reason };
      }
      const data = await res.json().catch(() => null);
      const text = parseGeminiText(data);
      if (text === null) return { ok: false, reason: "bad_response" };
      if (!text.trim()) return { ok: false, reason: "empty" };
      return { ok: true, text: text.trim(), source: "gemini" };
    } catch (e) {
      reason = e instanceof Error && e.name === "AbortError" ? "timeout" : "http_error";
      if (attempt < MAX_ATTEMPTS - 1) continue; // retry timeouts / network blips
      return { ok: false, reason };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, reason };
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
  "You are Navo's study coach. You are given a student's workload for a specific period " +
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

// --- Assignment "how to approach" + sub-steps (the assignment-detail page) -------
// ONE Gemini call → a short approach + ordered sub-steps. Fails open to empty.

export const DEFAULT_ASSIGNMENT_PLAN_INSTRUCTION =
  "You are Navo's study coach. For the assignment below, reply with ONLY a JSON object " +
  '{"approach": string, "steps": string[]}. "approach" is 1-2 plain-English sentences on how to ' +
  'tackle it well. "steps" is 3-5 short, concrete sub-steps in the order to do them (each a short ' +
  "imperative phrase). Be specific to the assignment's title and type, but do NOT invent precise " +
  "requirements, page numbers, or rubric criteria you cannot know. No markdown.";

export type AssignmentPlan = { approach: string | null; steps: string[]; source: "gemini" | "none" };

export async function generateAssignmentPlan(input: AssignmentDescInput, instruction: string = DEFAULT_ASSIGNMENT_PLAN_INSTRUCTION): Promise<AssignmentPlan> {
  const res = await runGemini(`${instruction}\n\n${buildDescriptionPrompt(input)}`, 320, true);
  if (!res.ok) return { approach: null, steps: [], source: "none" };
  try {
    const parsed = JSON.parse(res.text) as { approach?: unknown; steps?: unknown };
    const approach = typeof parsed.approach === "string" && parsed.approach.trim() ? parsed.approach.trim() : null;
    const steps = Array.isArray(parsed.steps)
      ? parsed.steps.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim()).slice(0, 6)
      : [];
    // An empty-but-valid response is reported as "none" so callers don't CACHE a
    // blank plan for the full TTL (which would hide the section until expiry); the
    // next visit retries instead.
    if (!approach && steps.length === 0) return { approach: null, steps: [], source: "none" };
    return { approach, steps, source: "gemini" };
  } catch {
    return { approach: null, steps: [], source: "none" };
  }
}

// --- Dashboard summary + week intensity (Home) -------------------------------
// ONE Gemini call returns both a short "what to focus on this week" briefing AND
// a traffic-light rating of how demanding the week is. The rating ALWAYS resolves
// — deterministicIntensity (lib/intensity) is the fail-open fallback — so the
// dashboard KPI is never blank when Gemini is unavailable.

export const DASHBOARD_SUMMARY_INSTRUCTION =
  "You are Navo's study coach. From the student's week summary and ranked priorities, reply with ONLY a JSON " +
  'object of the form {"summary": string, "intensity": "easy" | "moderate" | "hard"}. ' +
  '"summary" is a warm, plain-English 2-3 sentence briefing of what to focus on this week and why — no markdown, no ' +
  'lists, no headings. "intensity" is your judgment of how demanding THIS WEEK is overall, weighing the number and ' +
  "importance of items due, the exams/quizzes, and whether the planned work fits the time available. Do not invent " +
  "assignments, points, or deadlines beyond what is given.";

export interface DashboardSummaryInput extends WeekLoad {
  firstName: string;
  windowDays: number;
  atRiskCount: number;
  top: ScoredAssignment[];
}

export type DashboardSummary = { summary: string | null; intensity: Intensity; source: "gemini" | "fallback" };

const INTENSITIES: readonly Intensity[] = ["easy", "moderate", "hard"];

export function buildDashboardPrompt(i: DashboardSummaryInput): string {
  const lines = [
    `Student: ${i.firstName || "there"}. Planning window: ${i.windowDays} days.`,
    `Due this week: ${i.dueThisWeek} (exams/quizzes among them: ${i.examQuiz}). Overdue: ${i.atRiskCount}.`,
    `Planned study load: ${Math.round(i.workHours)}h against ~${Math.round(i.budgetHours)}h available` +
      (i.overloadHours >= 1 ? ` (over by ${Math.round(i.overloadHours)}h).` : "."),
  ];
  if (i.top.length) {
    lines.push("Top priorities (already ranked by our system):");
    i.top.forEach((t, n) => lines.push(`${n + 1}. ${t.name} (${t.courseName})${t.reason ? ` — ${t.reason}` : ""}`));
  } else {
    lines.push("No outstanding priorities.");
  }
  return lines.join("\n");
}

/** Fails open: any failure → null summary + the deterministic rating. */
export async function generateDashboardSummary(
  input: DashboardSummaryInput,
  instruction: string = DASHBOARD_SUMMARY_INSTRUCTION,
): Promise<DashboardSummary> {
  const fallback = deterministicIntensity(input);
  const res = await runGemini(`${instruction}\n\n${buildDashboardPrompt(input)}`, 260, true);
  if (!res.ok) return { summary: null, intensity: fallback, source: "fallback" };
  try {
    const parsed = JSON.parse(res.text) as { summary?: unknown; intensity?: unknown };
    const summary = typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : null;
    const intensity = INTENSITIES.includes(parsed.intensity as Intensity) ? (parsed.intensity as Intensity) : fallback;
    return { summary, intensity, source: "gemini" };
  } catch {
    return { summary: null, intensity: fallback, source: "fallback" };
  }
}
