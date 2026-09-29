// A course's late-work policy + the Gemini step that reads it from the syllabus.
//
// Deliberately SIMPLE so Gemini can fill it reliably (Calvin's ask): one small
// object per course — a 3-way `kind` plus a single fraction. Everything fails
// OPEN to "no late credit" (the safe default: push deadlines, never silently
// assume a forgiving policy). Mirrors lib/analysis.ts (batched, server-only key,
// never throws).

import { createHash } from "crypto";
import { geminiPost, salvageJsonObjects, GEMINI_URL, geminiKey } from "./geminiFetch";
import { parseGradingScheme, type GradingScheme } from "./gradingScheme";

export type LateKind = "none" | "flat" | "perday";

export interface LatePolicy {
  kind: LateKind;
  // Fraction of credit LOST, 0..1.
  //  • flat   → one-time loss (0.5 = a flat −50% for any late work)
  //  • perday → loss per day late (0.1 = −10%/day; "one letter grade/day" ≈ 0.1)
  //  • none   → 0 (late work earns nothing)
  // A real NO-PENALTY policy (late work accepted, nothing lost) is { kind: "flat",
  // value: 0 } — salvage 1, slip loss 0. "Unknown" is NOT a kind: it is a course
  // with no stored kind (null), which callers read as DEFAULT_LATE_POLICY.
  value: number;
}

export const DEFAULT_LATE_POLICY: LatePolicy = { kind: "none", value: 0 };

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Fraction of credit STILL EARNABLE if submitted `daysLate` days late. Drives
 *  whether an overdue item is still worth doing. */
export function salvageFraction(p: LatePolicy, daysLate: number): number {
  const t = Math.max(0, daysLate);
  switch (p.kind) {
    case "none":
      return 0; // not accepted late → nothing left to win
    case "flat":
      return clamp01(1 - p.value); // fixed penalty no matter how late (value 0 = no penalty → 1)
    case "perday":
      return clamp01(1 - p.value * t); // bleeds per day (value 0 = no penalty → 1)
  }
}

/** Fraction LOST by slipping ~one day past the deadline — scales an on-time
 *  item's deadline pressure (forgiving policy ⇒ low pressure, can defer). */
export function slipLoss(p: LatePolicy): number {
  switch (p.kind) {
    case "none":
      return 1; // miss it = lose everything → maximum pressure
    case "flat":
      return clamp01(p.value); // no-penalty policy → 0: slipping a day costs nothing
    case "perday":
      return clamp01(p.value);
  }
}

export function isLateKind(v: unknown): v is LateKind {
  return v === "none" || v === "flat" || v === "perday";
}

/** Validate one raw `{kind,value}` (from Gemini or storage) into a safe policy.
 *  Fails open to the no-credit default on anything malformed (unknown kind, a
 *  missing / non-numeric / negative value). A flat or per-day penalty of 0 is a
 *  REAL answer — late work accepted with no penalty — and is kept as
 *  { kind: "flat", value: 0 } (audit fix: it used to collapse into "none", i.e.
 *  "late work not accepted", the opposite). */
export function coerceLatePolicy(raw: unknown): LatePolicy {
  if (!raw || typeof raw !== "object") return DEFAULT_LATE_POLICY;
  const r = raw as Record<string, unknown>;
  if (!isLateKind(r.kind)) return DEFAULT_LATE_POLICY;
  if (r.kind === "none") return { kind: "none", value: 0 };
  const n = typeof r.value === "number" ? r.value : typeof r.value === "string" && r.value.trim() !== "" ? Number(r.value) : NaN;
  if (!Number.isFinite(n) || n < 0) return DEFAULT_LATE_POLICY;
  const value = clamp01(n);
  if (value === 0) return { kind: "flat", value: 0 }; // no penalty (a 0/day per-day policy is the same thing)
  return { kind: r.kind, value };
}

// --- Gemini: read the late policy out of a syllabus -------------------------

/** Per-call timeout (#144: raised from 12s for the larger policy + grading reply).
 *  The sync passes a smaller one near the end of its budget (lib/sync). */
export const LATE_POLICY_TIMEOUT_MS = 20_000;
export const MAX_SYLLABUS_CHARS = 4000;

/** #144: the same read also extracts the grading scheme (lib/gradingScheme). The
 *  model must copy numbers the syllabus states — never estimate them — and answer
 *  in JSON only (owner's AI-voice rule: no hedged or explanatory prose). */
export const GRADING_INSTRUCTION =
  "ALSO read the syllabus's GRADING breakdown. When the syllabus states it, add to that course's object " +
  '"grading":{"totalPoints":<number>,"categories":[{"name":"<category name as written>","weight":<share of the final grade as a decimal 0–1>,"count":<number of items in that category over the whole course>}]}. ' +
  "A category given in points instead of percent (Homework 200 of 1000 points) → weight = its points ÷ the course's total points (0.2). " +
  "Use ONLY numbers the syllabus states: omit totalPoints when no course point total is stated, omit count when the number of items is not stated, " +
  'and omit "grading" entirely when the syllabus gives no grading breakdown. Never estimate, guess, or invent a number. ' +
  "Output JSON only: no explanations, notes, caveats, or text outside the JSON.";

// Editable later from /admin/ai if desired; this is the fallback.
export const DEFAULT_LATE_INSTRUCTION =
  "You are reading a course SYLLABUS to find its LATE WORK / LATE SUBMISSION policy. " +
  'For EACH course, return how much credit late work loses, as JSON {"kind":...,"value":...}. ' +
  '`kind` is EXACTLY one of: "none" (late work not accepted / earns no credit), ' +
  '"flat" (one fixed penalty no matter how many days late), ' +
  '"perday" (penalty grows each day late). ' +
  "`value` is the FRACTION lost as a decimal 0–1: for flat, the one-time loss (50% off → 0.5); " +
  "for perday, the loss per day (10%/day → 0.1; one letter grade per day ≈ 0.1); for none, 0. " +
  'Late work accepted with NO penalty → {"kind":"flat","value":0}. ' +
  'If the syllabus does not mention a late policy, return {"kind":"none","value":0}. ' +
  GRADING_INSTRUCTION;

export interface LatePolicyInput {
  courseId: number;
  courseName: string;
  syllabus: string; // HTML or text; will be stripped + truncated
}

export interface LatePolicyResult {
  courseId: number;
  policy: LatePolicy;
  /** The syllabus's grading scheme; absent when it doesn't state one (#144). */
  grading?: GradingScheme | null;
  /** The reply was cut off inside this course's entry: only the policy (read
   *  before the cut) is usable — the caller stores it WITHOUT a hash (so the
   *  course is re-asked) and leaves its stored grading scheme alone. */
  truncated?: true;
}

export type LatePolicyResponse =
  | { ok: true; items: LatePolicyResult[]; source: "gemini" }
  | { ok: false; reason: "no_key" | "timeout" | "http_error" | "bad_response" };

function strip(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SYLLABUS_CHARS);
}

// --- Hash short-circuit (#126): a syllabus Gemini already read is never re-sent ---
//
// Mirrors lib/analysis.ts (`analysisInputHash` → `needsAnalysis`): the course row
// remembers a fingerprint of what the stored policy was parsed from, and a sync
// only asks Gemini about courses whose fingerprint changed. The fingerprint is
// taken over the SAME stripped + truncated text the prompt carries, so HTML or
// whitespace churn in Canvas (or edits past the prompt's cut-off) can't bust it.

/** Bump when the late-policy prompt/instruction or output shape changes, so every
 *  stored policy is re-parsed once on the next full sync (mirrors ANALYSIS_VERSION
 *  in lib/analysis.ts). */
export const LATE_POLICY_VERSION = 2; // 2 = + grading scheme (#144) and the no-penalty answer

/** sha256 (hex) of the syllabus text exactly as the prompt would see it, tagged with
 *  LATE_POLICY_VERSION. An empty or tag-only syllabus hashes a stable value, so it
 *  is never re-asked.
 *
 *  The course NAME is deliberately NOT hashed: it only labels the course in the
 *  prompt, and renaming a course in Canvas doesn't change its late-work policy —
 *  hashing it would spend a Gemini call on every rename for an identical answer. */
export function syllabusHash(syllabus: string): string {
  return createHash("sha256").update(`v${LATE_POLICY_VERSION}\u0000${strip(syllabus ?? "")}`).digest("hex");
}

/** Which courses actually need a Gemini read: those whose syllabus hash differs
 *  from the one stored with their current policy (or that have none yet). Pure.
 *  `hashes` carries the new hash for every course sent, so the caller stores it
 *  ONLY after a successful parse (a failure stores nothing → retried next sync). */
export function latePolicyWorkToDo(items: Array<LatePolicyInput & { storedHash: string | null }>): {
  toParse: LatePolicyInput[];
  hashes: Map<number, string>;
} {
  const toParse: LatePolicyInput[] = [];
  const hashes = new Map<number, string>();
  for (const { storedHash, ...input } of items) {
    const hash = syllabusHash(input.syllabus);
    if (storedHash === hash) continue; // unchanged → keep the stored policy, zero Gemini
    toParse.push(input);
    hashes.set(input.courseId, hash);
  }
  return { toParse, hashes };
}

export function buildLatePolicyPrompt(items: LatePolicyInput[]): string {
  const lines = items.map((i) => `#${i.courseId} ${i.courseName}: ${strip(i.syllabus) || "(no syllabus text)"}`);
  return [
    "Courses (one syllabus each — return one object per course, SAME ORDER, echoing its id):",
    ...lines,
    'Return ONLY a JSON array: [{"id":<courseId>,"kind":"none|flat|perday","value":<number>,"grading":{"totalPoints":<number>,"categories":[{"name":<string>,"weight":<number>,"count":<number>}]}}] — "grading" and its fields only when the syllabus states them.',
  ].join("\n");
}

/** A course entry's policy fields, read from the (cut-off) raw text — only when
 *  the number is followed by `,` or `}` (so a value cut mid-digit isn't read). */
const PARTIAL_ENTRY = /\{\s*"id"\s*:\s*(\d+)\s*,\s*"kind"\s*:\s*"([a-z]+)"\s*,\s*"value"\s*:\s*(-?\d+(?:\.\d+)?)\s*[,}]/g;

/** Parse Gemini's array, matching BY id; guards every level; never throws. Any
 *  course Gemini omits, or answers with an unknown `kind`, simply isn't in the
 *  result → the caller leaves it untouched (and un-hashed, so it's retried).
 *  A CUT-OFF reply (finishReason MAX_TOKENS, or JSON that doesn't parse): the
 *  complete entries are kept as usual; an entry cut inside its grading object
 *  keeps its policy, marked `truncated` (no hash, grading untouched). */
export function parseLatePolicies(json: unknown, inputs: LatePolicyInput[]): LatePolicyResult[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts = (json as any)?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("").trim();
  if (!text) return [];
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cutOff = (json as any)?.candidates?.[0]?.finishReason === "MAX_TOKENS";
  let list: unknown[];
  try {
    const arr: unknown = JSON.parse(cleaned);
    list = Array.isArray(arr)
      ? arr
      : arr && typeof arr === "object"
        ? ((Object.values(arr as Record<string, unknown>).find((v) => Array.isArray(v)) as unknown[]) ?? [])
        : [];
  } catch {
    list = salvageJsonObjects(cleaned); // keep complete objects from truncated/garbled JSON
    cutOff = true;
  }
  const known = new Set(inputs.map((i) => i.courseId));
  const out: LatePolicyResult[] = [];
  for (const el of list) {
    if (!el || typeof el !== "object") continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = el as any;
    const courseId = Number(e.id);
    if (!Number.isFinite(courseId) || !known.has(courseId)) continue;
    // A garbled `kind` is NOT an answer: leave the course out (the caller then
    // stores no policy and no hash → it's re-asked next sync) instead of pinning
    // it to the harshest "none" default until its syllabus changes (#126 review).
    if (!isLateKind(e.kind)) continue;
    const grading = parseGradingScheme(e.grading);
    out.push({ courseId, policy: coerceLatePolicy(e), ...(grading ? { grading } : {}) });
  }
  if (cutOff) {
    const seen = new Set(out.map((o) => o.courseId));
    for (const m of cleaned.matchAll(PARTIAL_ENTRY)) {
      const courseId = Number(m[1]);
      if (!known.has(courseId) || seen.has(courseId) || !isLateKind(m[2])) continue;
      seen.add(courseId);
      out.push({ courseId, policy: coerceLatePolicy({ kind: m[2], value: Number(m[3]) }), truncated: true });
    }
  }
  return out;
}

export async function analyzeLatePolicies(
  items: LatePolicyInput[],
  instruction: string = DEFAULT_LATE_INSTRUCTION,
  opts?: { timeoutMs?: number },
): Promise<LatePolicyResponse> {
  const key = geminiKey();
  if (!key) return { ok: false, reason: "no_key" };
  if (items.length === 0) return { ok: true, items: [], source: "gemini" };

  const body = {
    contents: [{ role: "user", parts: [{ text: `${instruction}\n\n${buildLatePolicyPrompt(items)}` }] }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: Math.min(8192, 256 + items.length * 400), // policy + grading object (#144); a cut reply is handled in parseLatePolicies
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  // Same transient-failure backoff as the assignment analysis (see lib/geminiFetch).
  const { res, timedOut } = await geminiPost(`${GEMINI_URL}?key=${encodeURIComponent(key)}`, body, { timeoutMs: opts?.timeoutMs ?? LATE_POLICY_TIMEOUT_MS });
  if (timedOut) return { ok: false, reason: "timeout" };
  if (!res || !res.ok) return { ok: false, reason: "http_error" };
  const json = await res.json().catch(() => null);
  if (json === null) return { ok: false, reason: "bad_response" };
  return { ok: true, items: parseLatePolicies(json, items), source: "gemini" };
}
