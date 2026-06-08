// Per-assignment AI analysis: Gemini estimates each assignment's effort (hours +
// quick/medium/long bucket) and writes a one-line summary, in ONE batched call.
// Pure logic + a thin fetch; fails OPEN (no key/error → empty → callers fall back
// to the flat effort and no summary). Server-only key. Mirrors lib/briefing.ts.

import { createHash } from "crypto";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";
const TIMEOUT_MS = 12000;
export const MAX_BATCH = 40;

// Editable from /admin/ai (stored under ANALYSIS_PROMPT_KEY); this is the fallback.
export const DEFAULT_ANALYSIS_INSTRUCTION =
  "You are StudyPlan's workload estimator. For EACH assignment given, estimate how long a typical " +
  "college student needs, and write one short factual sentence summarizing the task. " +
  "hours is your best numeric estimate (0.25–20); if unsure, still give your best number and set the " +
  "bucket as the coarse fallback (quick≈1h, medium≈3h, long≈6h). Keep summaries under 1 sentence.";

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
 *  the due date, so a deadline change doesn't burn a re-analysis. */
export function analysisInputHash(i: AnalysisItemInput): string {
  const basis = JSON.stringify({ n: i.name, c: i.courseName, p: i.pointsPossible, d: cleanDescription(i.description) });
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
      '{"id":<number>,"hours":<number>,"bucket":"quick|medium|long","summary":"<one sentence>"}.',
  ].join("\n");
}

function extractGeminiText(json: unknown): string | null {
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
  let arr: unknown;
  try {
    arr = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) {
    // Tolerate a wrapping object, e.g. { "assignments": [...] } or { "items": [...] }.
    if (arr && typeof arr === "object") {
      const nested = Object.values(arr as Record<string, unknown>).find((v) => Array.isArray(v));
      if (Array.isArray(nested)) arr = nested;
      else return [];
    } else return [];
  }

  const byId = new Map(inputs.map((i) => [i.canvasId, i]));
  const out: AnalysisItemResult[] = [];
  for (const el of arr) {
    if (!el || typeof el !== "object") continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = el as any;
    const id = Number(e.id);
    if (!Number.isFinite(id) || !byId.has(id)) continue;

    let hours: number | null = Number.isFinite(Number(e.hours)) ? clampHours(Number(e.hours)) : null;
    let bucket: EffortBucket | null = isBucket(e.bucket) ? e.bucket : null;
    if (hours === null && bucket !== null) hours = bucketToHours(bucket);
    if (bucket === null && hours !== null) bucket = hoursToBucket(hours);

    const summary = cleanSummary(e.summary);
    if (hours === null && summary === null) continue; // nothing usable
    out.push({ canvasId: id, estimatedEffortHours: hours, bucket, summary });
  }
  return out;
}

function geminiKey(): string | undefined {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const hit = Object.entries(process.env).find(([k]) => k.toLowerCase() === "gemini_api_key");
  return hit?.[1] || undefined;
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
      maxOutputTokens: Math.min(4000, 256 + items.length * 80),
      responseMimeType: "application/json",
    },
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
    if (json === null) return { ok: false, reason: "bad_response" };
    const parsed = parseAnalysis(json, items);
    if (parsed.length === 0) {
      // eslint-disable-next-line no-console
      console.warn("[analysis] 0 parsed from", items.length, "items; raw:", extractGeminiText(json)?.slice(0, 300));
    }
    return { ok: true, items: parsed, source: "gemini" };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return { ok: false, reason: "timeout" };
    return { ok: false, reason: "http_error" };
  } finally {
    clearTimeout(timer);
  }
}
