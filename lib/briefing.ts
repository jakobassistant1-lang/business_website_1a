// AI "daily briefing" via Google Gemini (Flash-Lite). Narration layer ONLY —
// it explains the already-ranked priorities in plain language; it does not
// compute them (lib/priority.ts does). Server-only: GEMINI_API_KEY never leaves
// the server. Fails OPEN: every path returns a typed result, never throws, so
// the Plan page always renders the full plan + recommendations without it.
//
// ONE voice (#145): every student-facing prompt builder — here, in lib/study.ts
// and lib/analysis.ts — appends the same rules IN CODE (`VOICE_RULES`), so an
// admin-edited instruction can never drop them: confident (no hedging, never
// "this is a guess"), no greeting/name, exact timing, "course"/"past due". The
// facts handed to the model match the screen: the clean course name, the type
// label, the app's importance order, and dates read in the student's Canvas zone
// (lib/studentZone) through lib/dueLabel. A fact that is missing is OMITTED — the
// model never sees "unknown" or "?".

import type { ScoredAssignment } from "./priority";
import { deterministicIntensity, resolveIntensity, type Intensity, type WeekLoad } from "./intensity";
import { geminiPost, GEMINI_URL, geminiKey } from "./geminiFetch";
import { MONTHS_SHORT, WEEKDAYS_FULL, parseYmd } from "./calendarDates";
import { dueParts, formatDue } from "./dueLabel";
import { dayDiffInZone, todayInZone } from "./studentZone";
import { shortCourse } from "./courseName";
import { TYPE_LABEL, type ItemType } from "./itemType";
import { effortHoursText } from "./effortFormat";

const TIMEOUT_MS = 6000;

/** Bump when the coach/summary/approach prompts change: the routes put it in their
 *  cache keys, so text generated under the old prompt is regenerated. v2 = #145. */
export const VOICE_VERSION = 2;

// --- The shared voice rules (#140, #145) --------------------------------------

export const CONFIDENCE_RULE =
  "Confidence: state only what the information given here supports, plainly and directly. Never say or imply that " +
  "you are guessing, unsure, or missing information. Never hedge: do not use likely, probably, possibly, might, may, " +
  "seems, appears or perhaps to express doubt, and never write \"I think\", \"it looks like\", \"this is a guess\", " +
  "\"the brief is short\", \"not specified\" or \"unclear\". Assignment titles, course names and dates are facts: " +
  "always copy them exactly as given, even when they contain one of these words (a title like \"Unknown Compounds " +
  "Lab\", a date like May 4). If a fact is not given, do not mention it at all: write about what IS given. Never " +
  "apologise, never mention being an AI, and never ask the student a question.";

export const TIMING_RULE =
  "Timing: use the dates and day counts given (\"by Wed, Oct 12\", \"in 15 days\", \"tomorrow\"). Never call anything " +
  "imminent, urgent, last-minute or \"right around the corner\" unless it is due within 3 days.";

export const NO_GREETING_RULE =
  "Open with the concrete next action, in a calm, direct tone. No greeting, no name, and no reassurance clichés " +
  "(no \"take a deep breath\", \"don't worry\", \"you've got this\", \"no need to stress\").";

/** Scoped to the student's own coursework, so subject vocabulary (a Java "class",
 *  an "overdue" library fine in an economics problem) is never restricted. */
export const WORDING_RULE =
  "Wording: when you refer to the student's own courses and deadlines, say \"course\", never \"class\", and say " +
  "\"past due\", never \"overdue\".";

/** Appended by every COACHING prompt builder (the voice that speaks to the student
 *  about their work), after the (editable) instruction. Study CONTENT (guides,
 *  practice questions) and the stored one-line summary get narrower rule sets —
 *  see lib/study.ts CONTENT_RULES and lib/analysis.ts. */
export const VOICE_RULES: readonly string[] = [CONFIDENCE_RULE, NO_GREETING_RULE, TIMING_RULE, WORDING_RULE];

// --- The facts, worded the way the screen words them ----------------------------

/** "Today is Monday, Sep 28." — the student's calendar day in their zone. */
export function promptToday(timeZone: string, now: Date = new Date()): string {
  const p = dueParts(now.toISOString(), timeZone);
  return `Today is ${WEEKDAYS_FULL[p.weekday]}, ${MONTHS_SHORT[p.month]} ${p.day}.`;
}

/** A due instant as display text, no day count: "Wed, Sep 30 · 11:59 PM" (lib/dueLabel
 *  "long-time", the student's zone). For text that is SAVED and re-shown on later
 *  days (the study plan, guide, questions), where a count would go stale. */
export function promptDate(due: string | Date, timeZone: string, now: Date = new Date()): string {
  const iso = typeof due === "string" ? due : due.toISOString();
  return formatDue(iso, "long-time", { todayYmd: todayInZone(timeZone, now), timeZone });
}

/** A due instant for a prompt: lib/dueLabel's "long-time" wording in the student's
 *  zone plus the exact day count — "Wed, Sep 30 · 11:59 PM (in 2 days)",
 *  "… (today)", "… (past due by 3 days)". THE one date wording across prompts. */
export function promptDue(due: string | Date, timeZone: string, now: Date = new Date()): string {
  const iso = typeof due === "string" ? due : due.toISOString();
  const words = promptDate(iso, timeZone, now);
  const n = dayDiffInZone(iso, timeZone, now);
  return `${words} (${n >= 0 ? inDays(n) : `past due by ${-n} day${n === -1 ? "" : "s"}`})`;
}

/** The on-screen type label ("Assignment" / "Quiz" / "Exam" / "Task"). */
export function promptType(type: string): string {
  return TYPE_LABEL[type as ItemType] ?? type;
}

/** One item, as every list prompt shows it. Missing values are left out. */
export interface PromptItem {
  name: string;
  courseName: string; // raw Canvas name; cleaned here (shortCourse)
  type: string; // ItemType
  dueAt: string | null; // ISO instant
  points?: number | null;
  effortHours?: number | null; // effectiveEffort — formatted once, by effortHoursText
}

export function promptItemLine(it: PromptItem, timeZone: string, now: Date = new Date()): string {
  const bits = [`${it.name} (${shortCourse(it.courseName)}) [${promptType(it.type)}]`];
  if (it.dueAt) bits.push(`due ${promptDue(it.dueAt, timeZone, now)}`);
  if (it.points != null && it.points > 0) bits.push(`${it.points} pts`);
  const effort = effortHoursText(it.effortHours);
  if (effort) bits.push(`effort ${effort}`);
  return bits.length === 1 ? bits[0] : `${bits[0]} — ${bits.slice(1).join(", ")}`;
}

/** Whole calendar days from `todayYmd` to `dueYmd` (both "YYYY-MM-DD"). */
export function dayCount(dueYmd: string, todayYmd: string): number {
  return Math.round((parseYmd(dueYmd).getTime() - parseYmd(todayYmd).getTime()) / 86_400_000);
}

/** "today" · "tomorrow" · "in 15 days" · "3 days ago". */
export function inDays(n: number): string {
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

// --- Legacy daily briefing (retired Plan view) ----------------------------------

// Editable from /admin/ai (stored in the Setting table). This is the fallback
// when no custom prompt has been saved.
export const DEFAULT_BRIEFING_INSTRUCTION =
  "You are Navo's study coach. Given the student's plan summary and their top priorities, " +
  "write a calm, direct, plain-English briefing of 2-4 short sentences telling them what to focus on today and why. " +
  "Do not invent assignments, points, or deadlines beyond what is given. No markdown, no lists, no headings.";

export interface BriefingInput {
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
  // plan.atRisk holds past-due AND won't-fit items, so it is labelled "at risk".
  lines.push(`Window: ${input.windowDays} days. Due in window: ${input.inWindowDueCount}. At risk (past due or not fitting the schedule): ${input.atRiskCount}.`);
  if (input.top.length) {
    lines.push("Top priorities, in the app's importance order (most important first):");
    input.top.forEach((t, i) => lines.push(`${i + 1}. ${t.name} (${shortCourse(t.courseName)})`));
  } else {
    lines.push("No outstanding priorities.");
  }
  lines.push(...VOICE_RULES);
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

/** Shared Gemini call. `fullPrompt` already includes the instruction + data.
 *  Fails open: every path returns a typed BriefingResult, never throws. The shared
 *  geminiPost backs off through transient 429/503/network blips. */
async function runGemini(fullPrompt: string, maxOutputTokens: number, json = false): Promise<BriefingResult> {
  const key = geminiKey();
  if (!key) return { ok: false, reason: "no_key" }; // zero network, zero cost

  const body = {
    contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens, thinkingConfig: { thinkingBudget: 0 }, ...(json ? { responseMimeType: "application/json" } : {}) },
  };

  const { res, timedOut } = await geminiPost(`${GEMINI_URL}?key=${encodeURIComponent(key)}`, body, { timeoutMs: TIMEOUT_MS });
  if (timedOut) return { ok: false, reason: "timeout" };
  if (!res || !res.ok) return { ok: false, reason: "http_error" };
  const data = await res.json().catch(() => null);
  const text = parseGeminiText(data);
  if (text === null) return { ok: false, reason: "bad_response" };
  if (!text.trim()) return { ok: false, reason: "empty" };
  return { ok: true, text: text.trim(), source: "gemini" };
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
  "(today, this week, or this month): the items due in it, listed in the app's importance order (most important " +
  "first) and already scheduled to be deadline-safe. Each item is tagged with its type in [brackets]. Write a calm, " +
  "direct, practical game plan of 2-5 short sentences using evidence-based techniques MATCHED TO THE WORK:\n" +
  "- For [Exam] and [Quiz] items: recommend retrieval practice / active recall (self-testing, " +
  "flashcards, practice problems) and spaced review starting a few days ahead — not re-reading.\n" +
  "- For [Assignment] and [Task] items (labs, essays, projects, problem sets, discussions): recommend breaking the " +
  "task into steps, starting early, and focused work blocks. Do NOT suggest active recall or flashcards " +
  "for these — that advice only fits studying for a test.\n" +
  "Where it fits, suggest interleaving subjects, short breaks, and doing the hardest work " +
  "when energy is freshest. Tie advice to their ACTUAL items and dates. Never invent assignments, " +
  "points, or due dates beyond what is given, and never suggest doing something after its due date. " +
  "Plain English. No markdown, no lists, no headings.";

export interface PeriodBriefingInput {
  period: "day" | "week" | "month";
  rangeLabel: string; // "today", "Jun 9–15", "June 2026"
  dueCount: number;
  pastDueCount: number;
  busyHours: number; // calendar busy hours within the period
  top: PromptItem[]; // the app's importance order (CalendarData.ranked)
  timeZone: string; // the student's Canvas zone (lib/studentZone)
  now?: Date;
}

export function buildPeriodPrompt(input: PeriodBriefingInput): string {
  const now = input.now ?? new Date();
  const lines: string[] = [];
  lines.push(`${promptToday(input.timeZone, now)} Period: ${input.period} (${input.rangeLabel}).`);
  const counts = [`Items due in this period: ${input.dueCount}.`];
  if (input.pastDueCount > 0) counts.push(`Past due and not submitted: ${input.pastDueCount}.`);
  if (input.busyHours >= 1) counts.push(`Calendar busy hours in the period: ${Math.round(input.busyHours)}.`);
  lines.push(counts.join(" "));
  if (input.top.length) {
    lines.push("Items, in the app's importance order (most important first; already scheduled deadline-safe):");
    input.top.forEach((t, i) => lines.push(`${i + 1}. ${promptItemLine(t, input.timeZone, now)}`));
  } else {
    lines.push("Nothing is due in this period.");
  }
  lines.push(...VOICE_RULES);
  lines.push("Write the study-coach game plan for this period.");
  return lines.join("\n");
}

export async function generatePeriodBriefing(
  input: PeriodBriefingInput,
  instruction: string = DEFAULT_PERIOD_COACH_INSTRUCTION,
): Promise<BriefingResult> {
  return runGemini(`${instruction}\n\n${buildPeriodPrompt(input)}`, 320);
}

// --- Study hub orientation (the /study page header) --------------------------
// One sentence: the concrete first move for the test at the top of the list,
// with its real timing. Calm by being specific, not by reassuring.

export const STUDY_HUB_INSTRUCTION =
  "You are Navo's study coach, speaking to a student on their Study page, where their upcoming tests and " +
  "quizzes are listed in the app's importance order. Write ONE plain sentence (max ~30 words) that tells them the " +
  "concrete next action for the test at the TOP of their list (for example: \"Start the Unit 3 quiz prep, due in 15 " +
  "days, by writing out the key formulas from memory.\"). Be specific to their actual top test, but do NOT invent " +
  "tests, dates, topics, or details. Plain English. No markdown, no lists, no headings.";

export interface StudyHubInput {
  count: number; // total upcoming tests/quizzes
  top: PromptItem[]; // importance order (first = the next-up / featured test)
  timeZone: string; // the student's Canvas zone
  now?: Date;
}

export function buildStudyHubPrompt(input: StudyHubInput): string {
  const now = input.now ?? new Date();
  const lines = [`${promptToday(input.timeZone, now)} Upcoming tests and quizzes: ${input.count}.`];
  if (input.top.length) {
    lines.push("Their tests, in the app's importance order (study #1 first):");
    input.top.forEach((t, i) => lines.push(`${i + 1}. ${promptItemLine(t, input.timeZone, now)}`));
  }
  lines.push(...VOICE_RULES);
  lines.push("Write the study-page line.");
  return lines.join("\n");
}

export async function generateStudyHub(
  input: StudyHubInput,
  instruction: string = STUDY_HUB_INSTRUCTION,
): Promise<BriefingResult> {
  return runGemini(`${instruction}\n\n${buildStudyHubPrompt(input)}`, 200);
}

// --- Per-assignment description (shown when an item is opened) ----------------

export interface AssignmentDescInput {
  name: string;
  courseName: string; // raw Canvas name; cleaned here
  type: string; // ItemType
  points: number | null;
  dueAt: string | Date | null; // the due INSTANT; worded in `timeZone`
  /** The Canvas instructions as PLAIN text; "" / undefined = Canvas has none. */
  brief?: string | null;
  timeZone: string; // the student's Canvas zone (lib/studentZone)
  now?: Date;
}

const BRIEF_PROMPT_CHARS = 4000;

/** What the model is told when Canvas has no instructions: build only TRUE steps
 *  from the known facts — never invented content (worse than hedging). */
export const NO_INSTRUCTIONS_LINE =
  "Only the title, course, type, points and due date are known. Treat anything the title states (a time limit, a " +
  "submission step) as a given fact and build the steps from it, for example when to open it and how much time to " +
  "block before the due time. Every step must be true from these facts alone. Never invent topics, readings, problems " +
  "or requirements. Fewer, true steps beat more, invented ones.";

/** The facts block + the voice rules shared by the one-line description and the
 *  "how to approach" plan. With no instructions the model works from what it has
 *  (title, course, type, points, due date) and never remarks on the missing
 *  instructions. Pure (unit-tested). */
export function assignmentFacts(i: AssignmentDescInput): string {
  const now = i.now ?? new Date();
  const bits = [`Assignment: "${i.name}" in the course ${shortCourse(i.courseName)}.`, `Type: ${promptType(i.type)}.`];
  if (i.points != null && i.points > 0) bits.push(`Worth ${i.points} points.`);
  if (i.dueAt) bits.push(`Due ${promptDue(i.dueAt, i.timeZone, now)}.`);
  const lines = [bits.join(" "), promptToday(i.timeZone, now)];

  const brief = typeof i.brief === "string" ? i.brief.replace(/\s+/g, " ").trim() : "";
  if (brief) {
    lines.push(`Assignment instructions from Canvas:\n${brief.slice(0, BRIEF_PROMPT_CHARS)}`);
    lines.push("Use only the requirements these instructions state.");
  } else {
    lines.push(NO_INSTRUCTIONS_LINE);
  }
  lines.push(...VOICE_RULES);
  return lines.join("\n");
}

export function buildDescriptionPrompt(i: AssignmentDescInput): string {
  return (
    assignmentFacts(i) +
    "\nIn ONE plain-English sentence, say what the student will do and how to start. Be concrete and use only what " +
    "is given above. No preamble, no markdown."
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
  "tackle it, opening with the first concrete action (\"Start by…\"). " +
  '"steps" is up to 5 short, concrete sub-steps in the order to do them (each a short ' +
  "imperative phrase). Be specific to the instructions (when given), the title and the type, and use only " +
  "requirements that are given. No markdown.";

export type AssignmentPlan = { approach: string | null; steps: string[]; source: "gemini" | "none" };

/** The full "how to approach" prompt: instruction + facts + voice rules. Pure. */
export function buildAssignmentPlanPrompt(input: AssignmentDescInput, instruction: string = DEFAULT_ASSIGNMENT_PLAN_INSTRUCTION): string {
  return `${instruction}\n\n${assignmentFacts(input)}`;
}

export async function generateAssignmentPlan(input: AssignmentDescInput, instruction: string = DEFAULT_ASSIGNMENT_PLAN_INSTRUCTION): Promise<AssignmentPlan> {
  const res = await runGemini(buildAssignmentPlanPrompt(input, instruction), 320, true);
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
  'object of the form {"points": string[], "intensity": "easy" | "moderate" | "hard"}. ' +
  '"points" is 2-3 short, scannable bullets (each a brief phrase, max ~14 words) on what to focus on this week ' +
  "and why — calm, direct and plain-English, with NO leading bullet characters and no markdown. " +
  '"intensity" is your judgment of how demanding THIS WEEK is overall, weighing the number and ' +
  "importance of items due, the exams/quizzes, whether the planned work fits the time available, AND any past-due " +
  "work — past-due assignments are part of this week's load, so never call the week light or easy while any are " +
  "outstanding. Do not invent assignments, points, or deadlines beyond what is given.";

export interface DashboardSummaryInput extends WeekLoad {
  windowDays: number;
  top: PromptItem[]; // the app's importance order
  timeZone: string; // the student's Canvas zone
  now?: Date;
}

export type DashboardSummary = { points: string[]; intensity: Intensity; source: "gemini" | "fallback" };

const INTENSITIES: readonly Intensity[] = ["easy", "moderate", "hard"];

export function buildDashboardPrompt(i: DashboardSummaryInput): string {
  const now = i.now ?? new Date();
  const catchUp = effortHoursText(i.overdueHours);
  const lines = [
    `${promptToday(i.timeZone, now)} Planning window: ${i.windowDays} days.`,
    `Due this week: ${i.dueThisWeek} (exams/quizzes among them: ${i.examQuiz}).`,
    i.overdueCount > 0
      ? `Past due and still not submitted: ${i.overdueCount} assignment(s)` +
        (catchUp ? ` (${catchUp} of catch-up work)` : "") +
        ". That backlog is part of this week's load — this is NOT a light week."
      : "Nothing is past due.",
    `Planned study load: ${Math.round(i.workHours)}h against ${Math.round(i.budgetHours)}h available` +
      (i.overloadHours >= 1 ? ` (over by ${Math.round(i.overloadHours)}h).` : "."),
  ];
  if (i.top.length) {
    lines.push("Top priorities, in the app's importance order (most important first):");
    i.top.forEach((t, n) => lines.push(`${n + 1}. ${promptItemLine(t, i.timeZone, now)}`));
  } else {
    lines.push("No outstanding priorities.");
  }
  lines.push(...VOICE_RULES);
  return lines.join("\n");
}

/** Fails open: any failure → null summary + the deterministic rating. */
export async function generateDashboardSummary(
  input: DashboardSummaryInput,
  instruction: string = DASHBOARD_SUMMARY_INSTRUCTION,
): Promise<DashboardSummary> {
  const fallback = deterministicIntensity(input);
  const res = await runGemini(`${instruction}\n\n${buildDashboardPrompt(input)}`, 260, true);
  if (!res.ok) return { points: [], intensity: fallback, source: "fallback" };
  try {
    const parsed = JSON.parse(res.text) as { points?: unknown; intensity?: unknown };
    const points = Array.isArray(parsed.points)
      ? parsed.points
          .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
          .map((p) => p.trim().replace(/^[-•*]\s*/, "")) // strip any leading bullet char the model adds anyway
          .slice(0, 3)
      : [];
    // THE clamp (lib/intensity.resolveIntensity): Gemini's verdict is merged here and
    // nowhere else, and it can never land below the overdue floor (#62).
    const verdict = INTENSITIES.includes(parsed.intensity as Intensity) ? (parsed.intensity as Intensity) : null;
    return { points, intensity: resolveIntensity(verdict, input), source: "gemini" };
  } catch {
    return { points: [], intensity: fallback, source: "fallback" };
  }
}
