// A course's late-work policy + the Gemini step that reads it from the syllabus.
//
// Deliberately SIMPLE so Gemini can fill it reliably (Calvin's ask): one small
// object per course — a 3-way `kind` plus a single fraction. Everything fails
// OPEN to "no late credit" (the safe default: push deadlines, never silently
// assume a forgiving policy). Mirrors lib/analysis.ts (batched, server-only key,
// never throws).

import { geminiKey } from "./analysis";

export type LateKind = "none" | "flat" | "perday";

export interface LatePolicy {
  kind: LateKind;
  // Fraction of credit LOST, 0..1.
  //  • flat   → one-time loss (0.5 = a flat −50% for any late work)
  //  • perday → loss per day late (0.1 = −10%/day; "one letter grade/day" ≈ 0.1)
  //  • none   → 0 (late work earns nothing)
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
      return clamp01(1 - p.value); // fixed penalty no matter how late
    case "perday":
      return clamp01(1 - p.value * t); // bleeds per day
  }
}

/** Fraction LOST by slipping ~one day past the deadline — scales an on-time
 *  item's deadline pressure (forgiving policy ⇒ low pressure, can defer). */
export function slipLoss(p: LatePolicy): number {
  switch (p.kind) {
    case "none":
      return 1; // miss it = lose everything → maximum pressure
    case "flat":
      return clamp01(p.value);
    case "perday":
      return clamp01(p.value);
  }
}

export function isLateKind(v: unknown): v is LateKind {
  return v === "none" || v === "flat" || v === "perday";
}

/** Validate one raw `{kind,value}` (from Gemini or storage) into a safe policy.
 *  Fails open to the no-credit default on anything malformed. */
export function coerceLatePolicy(raw: unknown): LatePolicy {
  if (!raw || typeof raw !== "object") return DEFAULT_LATE_POLICY;
  const r = raw as Record<string, unknown>;
  if (!isLateKind(r.kind)) return DEFAULT_LATE_POLICY;
  if (r.kind === "none") return { kind: "none", value: 0 };
  const value = clamp01(Number(r.value));
  if (!(value > 0)) return DEFAULT_LATE_POLICY; // a flat/perday with no real penalty ≈ no policy
  return { kind: r.kind, value };
}

// --- Gemini: read the late policy out of a syllabus -------------------------

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";
const TIMEOUT_MS = 12000;
export const MAX_SYLLABUS_CHARS = 4000;

// Editable later from /admin/ai if desired; this is the fallback.
export const DEFAULT_LATE_INSTRUCTION =
  "You are reading a course SYLLABUS to find its LATE WORK / LATE SUBMISSION policy. " +
  'For EACH course, return how much credit late work loses, as JSON {"kind":...,"value":...}. ' +
  '`kind` is EXACTLY one of: "none" (late work not accepted / earns no credit), ' +
  '"flat" (one fixed penalty no matter how many days late), ' +
  '"perday" (penalty grows each day late). ' +
  "`value` is the FRACTION lost as a decimal 0–1: for flat, the one-time loss (50% off → 0.5); " +
  "for perday, the loss per day (10%/day → 0.1; one letter grade per day ≈ 0.1); for none, 0. " +
  'If the syllabus does not mention a late policy, return {"kind":"none","value":0}.';

export interface LatePolicyInput {
  courseId: number;
  courseName: string;
  syllabus: string; // HTML or text; will be stripped + truncated
}

export interface LatePolicyResult {
  courseId: number;
  policy: LatePolicy;
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

export function buildLatePolicyPrompt(items: LatePolicyInput[]): string {
  const lines = items.map((i) => `#${i.courseId} ${i.courseName}: ${strip(i.syllabus) || "(no syllabus text)"}`);
  return [
    "Courses (one syllabus each — return one object per course, SAME ORDER, echoing its id):",
    ...lines,
    'Return ONLY a JSON array: [{"id":<courseId>,"kind":"none|flat|perday","value":<number>}].',
  ].join("\n");
}

/** Parse Gemini's array, matching BY id; guards every level; never throws. Any
 *  course Gemini omits or garbles simply isn't in the result → caller defaults it. */
export function parseLatePolicies(json: unknown, inputs: LatePolicyInput[]): LatePolicyResult[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts = (json as any)?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("").trim();
  if (!text) return [];
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  let arr: unknown;
  try {
    arr = JSON.parse(cleaned);
  } catch {
    return [];
  }
  const list: unknown[] = Array.isArray(arr)
    ? arr
    : arr && typeof arr === "object"
      ? (Object.values(arr as Record<string, unknown>).find((v) => Array.isArray(v)) as unknown[]) ?? []
      : [];
  const known = new Set(inputs.map((i) => i.courseId));
  const out: LatePolicyResult[] = [];
  for (const el of list) {
    if (!el || typeof el !== "object") continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = el as any;
    const courseId = Number(e.id);
    if (!Number.isFinite(courseId) || !known.has(courseId)) continue;
    out.push({ courseId, policy: coerceLatePolicy(e) });
  }
  return out;
}

export async function analyzeLatePolicies(
  items: LatePolicyInput[],
  instruction: string = DEFAULT_LATE_INSTRUCTION,
): Promise<LatePolicyResponse> {
  const key = geminiKey();
  if (!key) return { ok: false, reason: "no_key" };
  if (items.length === 0) return { ok: true, items: [], source: "gemini" };

  const body = {
    contents: [{ role: "user", parts: [{ text: `${instruction}\n\n${buildLatePolicyPrompt(items)}` }] }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: Math.min(2000, 128 + items.length * 40),
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
    return { ok: true, items: parseLatePolicies(json, items), source: "gemini" };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return { ok: false, reason: "timeout" };
    return { ok: false, reason: "http_error" };
  } finally {
    clearTimeout(timer);
  }
}
