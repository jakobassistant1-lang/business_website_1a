// Per-assignment AI analysis: Gemini estimates each assignment's effort (hours +
// quick/medium/long bucket) and writes a one-line summary, in ONE batched call.
// Pure logic + a thin fetch; fails OPEN (no key/error → empty → callers fall back
// to the flat effort and no summary). Server-only key. Mirrors lib/briefing.ts.

import { createHash } from "crypto";
import { geminiPost, salvageJsonObjects, GEMINI_URL, geminiKey } from "./geminiFetch";

const TIMEOUT_MS = 12000;
export const MAX_BATCH = 40;

// Editable from /admin/ai (stored under ANALYSIS_PROMPT_KEY); this is the fallback.
export const DEFAULT_ANALYSIS_INSTRUCTION =
  "You are Navo's workload estimator. For EACH assignment given, estimate how long a typical " +
  "college student needs, write one short factual sentence summarizing the task, AND rate its " +
  "importance 1-5 (how high-stakes / weighty / cumulative it is for the grade: a final exam, midterm, " +
  "or major project ≈ 5; a routine low-point homework ≈ 2; use 3 if unsure). " +
  "hours is your best numeric estimate (0.25–20); if unsure, still give your best number and set the " +
  "bucket as the coarse fallback (quick≈1h, medium≈3h, long≈6h). Keep summaries under 1 sentence. " +
  "requiresAction=false is RARE — set it ONLY for an explicitly PASSIVE grade with nothing for the " +
  "student to do: class participation, engagement, attendance, or a column the description calls a " +
  "placeholder the teaching team fills in. EVERYTHING the student studies for, practices, reads, " +
  "writes, or submits is requiresAction=true — INCLUDING every exam, midterm, final, test, quiz, " +
  "practice assessment, and reading, even with no online submission. When in ANY doubt, use true.";

// Structured-output schema (Gemini `responseSchema`): forces EVERY field to be
// present on every item — critically `requiresAction`, which the model was silently
// omitting for some items in a batch (returning a summary but no boolean), leaving
// passive placeholders un-screened. The schema makes it commit to true/false.
const ANALYSIS_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      id: { type: "integer" },
      hours: { type: "number" },
      bucket: { type: "string", enum: ["quick", "medium", "long"] },
      summary: { type: "string" },
      importance: { type: "integer" },
      requiresAction: { type: "boolean" },
    },
    required: ["id", "hours", "bucket", "summary", "importance", "requiresAction"],
  },
} as const;

export type EffortBucket = "quick" | "medium" | "long";

export interface AnalysisItemInput {
  canvasId: number;
  name: string;
  courseName: string;
  pointsPossible: number | null;
  dueAt: string | null;
  description: string | null;
}

export interface AnalysisItemResult {
  canvasId: number;
  estimatedEffortHours: number | null;
  bucket: EffortBucket | null;
  summary: string | null;
  importance: number | null; // 1-5: how high-stakes; feeds the planner's time allocation
  requiresAction: boolean | null; // false = passive grade (participation/attendance) → excluded from ordering; null/true = keep
}

export type AnalysisResult =
  | { ok: true; items: AnalysisItemResult[]; source: "gemini" }
  | { ok: false; reason: "no_key" | "timeout" | "http_error" | "bad_response" };

// --- bucket ↔ hours ---
export const BUCKET_HOURS: Record<EffortBucket, number> = { quick: 1, medium: 3, long: 6 };
export const MIN_HOURS = 0.25;
export const MAX_HOURS = 20;

export function clampHours(n: number): number {
  return Math.min(MAX_HOURS, Math.max(MIN_HOURS, n));
}
export function bucketToHours(b: EffortBucket): number {
  return BUCKET_HOURS[b];
}
export function hoursToBucket(h: number): EffortBucket {
  if (h <= 1.5) return "quick";
  if (h <= 4.5) return "medium";
  return "long";
}
function isBucket(v: unknown): v is EffortBucket {
  return v === "quick" || v === "medium" || v === "long";
}
function cleanSummary(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 && t.length <= 240 ? t : null;
}

/** Strip HTML, collapse whitespace, truncate — Canvas descriptions are raw HTML. */
export function cleanDescription(html: string | null | undefined, maxLen = 500): string {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLen);
}

/** sha1 over the CONTENT that affects the estimate (name/points/description) — NOT
 *  the due date, so a deadline change doesn't burn a re-analysis. The version tag
 *  is bumped when the analysis output shape changes (e.g. adding `importance`), so
 *  previously-analyzed rows re-run once to pick up the new field. */
const ANALYSIS_VERSION = 5; // bumped: structured-output schema + conservative screen prompt → re-run
export function analysisInputHash(i: AnalysisItemInput): string {
  const basis = JSON.stringify({ v: ANALYSIS_VERSION, n: i.name, c: i.courseName, p: i.pointsPossible, d: cleanDescription(i.description) });
  return createHash("sha1").update(basis).digest("hex");
}

export interface AnalyzableRow extends AnalysisItemInput {
  analyzedAt: Date | null;
  analysisHash: string | null;
}
export function needsAnalysis(row: AnalyzableRow): boolean {
  if (row.analyzedAt === null) return true;
  return row.analysisHash !== analysisInputHash(row);
}
export function selectUnanalyzed(rows: AnalyzableRow[]): AnalysisItemInput[] {
  return rows.filter(needsAnalysis).map((r) => ({
    canvasId: r.canvasId,
    name: r.name,
    courseName: r.courseName,
    pointsPossible: r.pointsPossible,
    dueAt: r.dueAt,
    description: r.description,
  }));
}

export function buildAnalysisPrompt(items: AnalysisItemInput[]): string {
  const lines = items.map((i) => {
    const parts = [`#${i.canvasId}`, i.name, i.courseName, `${i.pointsPossible ?? "?"} pts`, `due ${i.dueAt ?? "none"}`];
    const desc = cleanDescription(i.description);
    if (desc) parts.push(desc);
    return parts.join(" | ");
  });
  return [
    "Assignments (estimate each, SAME ORDER):",
    ...lines,
    'Return ONLY a JSON array, one object per assignment: ' +
      '{"id":<number>,"hours":<number>,"bucket":"quick|medium|long","summary":"<one sentence>","importance":<1-5>,"requiresAction":<true|false>}.',
  ].join("\n");
}

export function extractGeminiText(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts = (json as any).candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("").trim();
  return text.length ? text : null;
}

/** Parse Gemini's JSON array, matching results to inputs BY ID (not position).
 *  Guards every level; never throws; omitted/garbage items are simply dropped. */
export function parseAnalysis(json: unknown, inputs: AnalysisItemInput[]): AnalysisItemResult[] {
  const text = extractGeminiText(json);
  if (!text) return [];
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let list: unknown[];
  try {
    const arr: unknown = JSON.parse(cleaned);
    if (Array.isArray(arr)) {
      list = arr;
    } else if (arr && typeof arr === "object") {
      // Tolerate a wrapping object, e.g. { "assignments": [...] } or { "items": [...] }.
      const nested = Object.values(arr as Record<string, unknown>).find((v) => Array.isArray(v));
      list = Array.isArray(nested) ? nested : [];
    } else {
      list = [];
    }
  } catch {
    // Truncated/garbled JSON (e.g. response cut off mid-array): salvage the complete
    // objects so one broken item doesn't discard the whole batch.
    list = salvageJsonObjects(cleaned);
  }
  if (list.length === 0) return [];

  const byId = new Map(inputs.map((i) => [i.canvasId, i]));
  const out: AnalysisItemResult[] = [];
  for (const el of list) {
    if (!el || typeof el !== "object") continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = el as any;
    // Tolerate models that echo the whole prompt line ("#86 | Name | …") instead
    // of the bare number — pull the leading id digits (after an optional '#').
    const id = Number(String(e.id ?? "").match(/^#?\s*(\d+)/)?.[1]);
    if (!Number.isFinite(id) || !byId.has(id)) continue;

    let hours: number | null = Number.isFinite(Number(e.hours)) ? clampHours(Number(e.hours)) : null;
    let bucket: EffortBucket | null = isBucket(e.bucket) ? e.bucket : null;
    if (hours === null && bucket !== null) hours = bucketToHours(bucket);
    if (bucket === null && hours !== null) bucket = hoursToBucket(hours);

    const summary = cleanSummary(e.summary);
    const importance = Number.isFinite(Number(e.importance))
      ? Math.max(1, Math.min(5, Math.round(Number(e.importance))))
      : null;
    const requiresAction =
      typeof e.requiresAction === "boolean"
        ? e.requiresAction
        : e.requiresAction === "true"
          ? true
          : e.requiresAction === "false"
            ? false
            : null;
    if (hours === null && summary === null && importance === null && requiresAction === null) continue; // nothing usable
    out.push({ canvasId: id, estimatedEffortHours: hours, bucket, summary, importance, requiresAction });
  }
  return out;
}

export async function analyzeAssignments(
  items: AnalysisItemInput[],
  instruction: string = DEFAULT_ANALYSIS_INSTRUCTION,
): Promise<AnalysisResult> {
  const key = geminiKey();
  if (!key) return { ok: false, reason: "no_key" };
  if (items.length === 0) return { ok: true, items: [], source: "gemini" };

  const body = {
    contents: [{ role: "user", parts: [{ text: `${instruction}\n\n${buildAnalysisPrompt(items)}` }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: Math.min(6000, 256 + items.length * 110),
      responseMimeType: "application/json",
      responseSchema: ANALYSIS_SCHEMA, // force requiresAction (+ all fields) to always be returned
    },
  };

  // Retries transient 429/503 with backoff (Gemini "high demand" spikes) so the
  // screen reliably populates instead of silently no-opping on a blip.
  const { res, timedOut } = await geminiPost(`${GEMINI_URL}?key=${encodeURIComponent(key)}`, body, { timeoutMs: TIMEOUT_MS });
  if (timedOut) return { ok: false, reason: "timeout" };
  if (!res || !res.ok) return { ok: false, reason: "http_error" };
  const json = await res.json().catch(() => null);
  if (json === null) return { ok: false, reason: "bad_response" };
  const parsed = parseAnalysis(json, items);
  if (parsed.length === 0) {
    // eslint-disable-next-line no-console
    console.warn("[analysis] 0 parsed from", items.length, "items; raw:", extractGeminiText(json)?.slice(0, 300));
  }
  return { ok: true, items: parsed, source: "gemini" };
}
