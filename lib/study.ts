// Study-page engine. Three artifacts per upcoming test/quiz, all cached (see
// /api/study + StudyGeneration):
//   plan      — the HOW layer mapped onto the scheduler's EXISTING study blocks
//               (never invents/moves sessions — the *when* stays deterministic)
//   guide     — topic-sectioned concept outline + key terms, from linked material
//   questions — interactive practice questions in a student-chosen type
//
// Material linkage (Decision A, hybrid): deterministic-first. 1) the Canvas
// MODULE that contains the assessment (content_id, or exact-title match —
// classic-quiz module items carry the quiz id, not the assignment id) → sibling
// pages/PDFs/links; 2) else a date-window fallback (announcements near the due
// date + syllabus). Then a Gemini RELEVANCE CHECK runs over the candidates on
// EVERY generation (no size gating): the model only returns keep-indices — code
// assembles the final set, the test's own instructions are never droppable, and
// any error/garbage/empty verdict fails OPEN to keeping everything. Dropped
// titles surface in the UI as receipts. Sparse material (<400 chars) →
// "low-material mode": the model leans on name/course/type and the UI labels
// the result. All parsers fail soft: malformed model items are dropped, never
// thrown.

import { createHash } from "crypto";
import { extractGeminiText } from "./analysis";
import { geminiPost, GEMINI_URL, geminiKey } from "./geminiFetch";
import {
  fetchModules,
  fetchPageBody,
  fetchSyllabus,
  fetchFileMeta,
  downloadCanvasFile,
  type CanvasModule,
  type CanvasModuleItem,
} from "./canvas";
import type { Plan } from "./scheduler";
import { ymd } from "./calendarDates";

const TIMEOUT_MS = 25000; // study artifacts are bigger than one-liners
export const STUDY_PROMPT_VERSION = 2; // bump → all cached generations revalidate (v2: relevance filter)

// Question types, content shapes, and the short-answer grader live in the
// client-safe lib/studyShared.ts (StudyView bundles them); re-exported here so
// server code imports everything from one place.
export * from "./studyShared";
import type {
  GuideSection,
  PlanSession,
  StudyGuideContent,
  StudyPlanContent,
  StudyQuestion,
  StudyQuestionType,
  StudyQuestionsContent,
} from "./studyShared";

// ---------- deterministic helpers ----------

export function studyHash(parts: Array<string | number | null | undefined>): string {
  return createHash("sha1").update(parts.map((p) => String(p ?? "")).join("\u0000")).digest("hex");
}

/** The scheduler's existing study blocks for one assessment — the deterministic
 *  "when" the plan layer annotates. */
export function studySessionsFor(plan: Plan, canvasId: number): { date: string; hours: number }[] {
  const out: { date: string; hours: number }[] = [];
  for (const day of plan.days) {
    for (const b of day.blocks) {
      if (b.study && b.canvasId === canvasId && b.hours > 0) out.push({ date: day.date, hours: b.hours });
    }
  }
  return out;
}

export function stripHtml(html: string | null | undefined, maxLen: number): string {
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

// (norm mirrors studyShared's — server-side matching for module/announcement linkage)
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// ---------- material collection (Decision A) ----------

export interface StudySource {
  kind: "description" | "page" | "file" | "announcement" | "syllabus" | "module_item";
  title: string;
  text: string;
}
export interface StudyMaterial {
  sources: StudySource[]; // the KEPT set (post relevance check), budget-capped
  moduleName: string | null;
  sparse: boolean;
  excluded: string[]; // titles the relevance check dropped — UI receipts
  aiFiltered: boolean; // false when the check was skipped/failed (kept everything)
  hash: string;
}

export interface AssessmentMeta {
  canvasId: number;
  name: string;
  courseName: string;
  courseCanvasId: number;
  type: string; // "quiz" | "exam"
  dueAt: Date | null;
  pointsPossible: number | null;
  description: string | null; // Canvas HTML
  aiSummary: string | null;
}

const TOTAL_BUDGET = 15000;
const MAX_PAGES = 6;
const MAX_PDFS = 3;
const PDF_MAX_BYTES = 8 * 1024 * 1024; // skip huge scans/textbooks
const PDF_MIN_TEXT = 80; // under this ⇒ a scanned/image PDF with no real text layer

function moduleContains(m: CanvasModule, a: AssessmentMeta): boolean {
  const wanted = norm(a.name);
  return (m.items ?? []).some(
    (it) =>
      ((it.type === "Assignment" || it.type === "Quiz") && it.content_id === a.canvasId) ||
      (!!it.title && norm(it.title) === wanted),
  );
}

// ---------- AI relevance check (the hybrid's second stage) ----------

const RELEVANCE_INSTRUCTION =
  "You are Navo's relevance checker. From the candidate materials below, decide which are actually relevant " +
  "to preparing for THIS assessment. Drop items clearly about other units/weeks/topics, or pure course logistics " +
  "(office hours, unrelated reminders). When unsure, KEEP the item.";

/** Parse the checker's verdict ({"keep":[…]} or a bare array) into in-range,
 *  deduped indices. null = unusable verdict → caller keeps everything. An EMPTY
 *  keep-list is also treated as a misfire (dropping all material is almost
 *  never right), not as "drop everything". */
export function parseKeepIndices(raw: unknown, max: number): number[] | null {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? (raw as Record<string, unknown>).keep
      : null;
  if (!Array.isArray(list)) return null;
  const out = [...new Set(list.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < max))];
  return out.length > 0 ? out : null;
}

/** Gemini screens the deterministic candidates on EVERY generation. The model
 *  only FILTERS — it returns indices to keep; code assembles the final set. The
 *  assessment's own instructions (kind "description") are never droppable.
 *  Fail open: no key / error / garbage / empty verdict ⇒ keep everything. */
async function relevanceFilter(
  a: AssessmentMeta,
  sources: StudySource[],
): Promise<{ kept: StudySource[]; excluded: string[]; aiFiltered: boolean }> {
  const candidates = sources.filter((s) => s.kind !== "description");
  // With 0-1 candidates there is nothing to choose between — vacuous check.
  if (candidates.length < 2) return { kept: sources, excluded: [], aiFiltered: false };

  const lines = candidates.map((s, i) => `[${i}] (${s.kind}) ${s.title}: ${s.text.slice(0, 240)}`);
  const prompt = [
    RELEVANCE_INSTRUCTION,
    "",
    metaLines(a),
    "",
    `Candidates:\n${lines.join("\n")}`,
    "",
    'Return ONLY JSON: {"keep":[<indices of the relevant candidates>]}',
  ].join("\n");

  const res = await callGemini(prompt, 300, 0.1);
  if (!res.ok) return { kept: sources, excluded: [], aiFiltered: false };
  const keep = parseKeepIndices(parseJsonText(res.json), candidates.length);
  if (!keep) return { kept: sources, excluded: [], aiFiltered: false };

  const keepSet = new Set(keep);
  return {
    // description-kind sources lead the array, so this preserves priority order.
    kept: [...sources.filter((s) => s.kind === "description"), ...candidates.filter((_, i) => keepSet.has(i))],
    excluded: candidates.filter((_, i) => !keepSet.has(i)).map((s) => s.title),
    aiFiltered: true,
  };
}

/** Deterministic material gathering. Network is fail-open at every step — worst
 *  case the material is just the assessment's own description. */
export async function collectStudyMaterial(
  host: string,
  token: string,
  assessment: AssessmentMeta,
  announcements: { title: string; message: string | null; postedAt: Date | null }[],
): Promise<StudyMaterial> {
  const sources: StudySource[] = [];
  const desc = stripHtml(assessment.description, 3000);
  if (desc) sources.push({ kind: "description", title: "Test instructions", text: desc });

  // 1) Module containment — Canvas's own unit structure.
  let modules: CanvasModule[] = [];
  try {
    modules = await fetchModules(host, token, assessment.courseCanvasId);
  } catch {
    /* fail open */
  }
  const mod = modules.find((m) => moduleContains(m, assessment)) ?? null;

  if (mod) {
    const siblings = (mod.items ?? []).filter(
      (it) => !((it.type === "Assignment" || it.type === "Quiz") && it.content_id === assessment.canvasId),
    );
    const pageItems = siblings.filter((it) => it.type === "Page" && it.page_url).slice(0, MAX_PAGES);
    const pages = await Promise.all(
      pageItems.map((it: CanvasModuleItem) => fetchPageBody(host, token, assessment.courseCanvasId, it.page_url as string)),
    );
    for (const p of pages) {
      if (!p) continue;
      const text = stripHtml(p.body, 3500);
      if (text) sources.push({ kind: "page", title: p.title, text });
    }
    // PDFs in the module: download (size-capped) + extract their text layer.
    // Scanned/image-only PDFs yield no text and are skipped. Every step fails
    // open — a broken file can never break generation.
    const fileItems = siblings.filter((it) => it.type === "File" && it.content_id).slice(0, 6);
    if (fileItems.length > 0) {
      const { PDFParse } = await import("pdf-parse");
      let taken = 0;
      for (const it of fileItems) {
        if (taken >= MAX_PDFS) break;
        const meta = await fetchFileMeta(host, token, it.content_id as number);
        if (!meta) continue;
        const isPdf = meta["content-type"] === "application/pdf" || /\.pdf$/i.test(meta.display_name);
        if (!isPdf || meta.size > PDF_MAX_BYTES) continue;
        const buf = await downloadCanvasFile(meta.url, PDF_MAX_BYTES);
        if (!buf) continue;
        try {
          const parser = new PDFParse({ data: buf });
          try {
            const res = await parser.getText();
            const text = (res?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 3500);
            if (text.length >= PDF_MIN_TEXT) {
              sources.push({ kind: "file", title: meta.display_name, text });
              taken++;
            }
          } finally {
            await (parser as { destroy?: () => Promise<void> }).destroy?.();
          }
        } catch {
          /* fail open per file */
        }
      }
    }

    // Other siblings (slides links, external tools, unparsed files): titles only —
    // LTI/external bodies are out of reach, but titles still say what the unit covers.
    const titled = siblings
      .filter((it) => it.type !== "Page" && it.type !== "SubHeader" && it.title)
      .slice(0, 12)
      .map((it) => it.title)
      .join("; ");
    if (titled) sources.push({ kind: "module_item", title: `Other items in "${mod.name}"`, text: titled });
  }

  // 2) Announcements that mention the test or land near the due date.
  const wanted = norm(assessment.name);
  const due = assessment.dueAt ? assessment.dueAt.getTime() : null;
  const windowMs = 14 * 86_400_000;
  const relevant = announcements
    .filter((an) => {
      const text = norm(`${an.title} ${an.message ?? ""}`);
      if (wanted && text.includes(wanted)) return true;
      if (due && an.postedAt) {
        const dt = due - an.postedAt.getTime();
        return dt >= 0 && dt <= windowMs;
      }
      return false;
    })
    .slice(0, 3);
  for (const an of relevant) {
    const text = stripHtml(an.message, 1200);
    if (text) sources.push({ kind: "announcement", title: `Announcement: ${an.title}`, text });
  }

  // 3) Syllabus — exam coverage often lives here (esp. without a module match).
  const syllabus = await fetchSyllabus(host, token, assessment.courseCanvasId);
  const sylText = stripHtml(syllabus, mod ? 1500 : 2500);
  if (sylText) sources.push({ kind: "syllabus", title: "Course syllabus", text: sylText });

  // Stage 2 of the hybrid: the AI relevance check screens the candidates on
  // every run (fail-open). Budget-cap AFTER filtering so dropped items can't
  // crowd out kept ones.
  const checked = await relevanceFilter(assessment, sources);

  // Enforce the total budget in priority order (array order = priority).
  let used = 0;
  const kept: StudySource[] = [];
  for (const s of checked.kept) {
    if (used >= TOTAL_BUDGET) break;
    const text = s.text.slice(0, TOTAL_BUDGET - used);
    used += text.length;
    kept.push({ ...s, text });
  }

  const combined = kept.map((s) => s.text).join("\n");
  return {
    sources: kept,
    moduleName: mod?.name ?? null,
    sparse: combined.length < 400,
    excluded: checked.excluded,
    aiFiltered: checked.aiFiltered,
    hash: studyHash([STUDY_PROMPT_VERSION, ...kept.map((s) => `${s.kind}:${s.title}:${s.text}`)]),
  };
}

// ---------- prompts ----------

function metaLines(a: AssessmentMeta): string {
  const due = a.dueAt ? `${ymd(a.dueAt)}` : "unknown";
  return [
    `Assessment: ${a.name} (${a.type})`,
    `Course: ${a.courseName}`,
    `Due: ${due} · Points: ${a.pointsPossible ?? "?"}`,
    a.aiSummary ? `Summary: ${a.aiSummary}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function materialBlock(material: StudyMaterial): string {
  if (material.sources.length === 0) return "No Canvas material was found for this assessment.";
  const chunks = material.sources.map((s, i) => `[S${i + 1} · ${s.kind} · ${s.title}]\n${s.text}`);
  return `Canvas material (use ONLY what is relevant to this assessment; ignore the rest):\n${chunks.join("\n\n")}`;
}

const LOW_MATERIAL_NOTE =
  "The Canvas material is thin. Lean on the assessment name, type, and course subject plus general " +
  "knowledge of the field; keep output focused and slightly shorter, and never invent specific " +
  "page numbers, dates, or teacher policies.";

// Admin-editable instructions (the coaching/voice half of each prompt — tunable
// from /admin/ai under "Study outputs"). The data blocks and the JSON output
// contracts below are NOT editable: the parsers depend on them.
export const DEFAULT_STUDY_PLAN_INSTRUCTION =
  "You are Navo's study coach. The schedule below is FIXED by the planner — do not add, move, or resize sessions. " +
  "For EACH listed session, say HOW to use it: a one-line focus, 1-3 named techniques (e.g. active recall, spaced practice, " +
  "self-testing, worked examples — early sessions lean understanding/encoding, later sessions lean retrieval/self-testing), " +
  "and 2-4 concrete activities.";

export const DEFAULT_STUDY_GUIDE_INSTRUCTION =
  "You are Navo's study-guide writer. Build a condensed, test-prep study guide from the material below. " +
  "Organize by topic: 3-6 sections, each with a short title, 3-6 tight bullet points (facts/concepts/skills to know), " +
  "and 0-6 key terms with one-line definitions.";

export const DEFAULT_STUDY_QUESTIONS_INSTRUCTION =
  "You are Navo's practice-question writer. Questions must test understanding of the material (not trivia about " +
  "course logistics). Vary difficulty. Explanations teach the underlying concept in 1-2 sentences.";

export function buildPlanPrompt(
  a: AssessmentMeta,
  sessions: { date: string; hours: number }[],
  instruction: string = DEFAULT_STUDY_PLAN_INSTRUCTION,
): string {
  const sess =
    sessions.length > 0
      ? sessions.map((s, i) => `${i + 1}. ${s.date} — ${s.hours}h`).join("\n")
      : "(none scheduled)";
  return [
    instruction,
    sessions.length === 0
      ? "There are NO scheduled sessions (the test is imminent). Return an empty sessions array and put a short, realistic last-minute strategy in `advice`."
      : "Also include 1-2 sentences of overall `advice`.",
    "",
    metaLines(a),
    "",
    `Scheduled study sessions:\n${sess}`,
    "",
    'Return ONLY JSON: {"advice": string, "sessions": [{"date":"YYYY-MM-DD","focus":string,"techniques":[string],"activities":[string]}]} — sessions MUST use exactly the dates listed.',
  ].join("\n");
}

export function buildGuidePrompt(
  a: AssessmentMeta,
  material: StudyMaterial,
  instruction: string = DEFAULT_STUDY_GUIDE_INSTRUCTION,
): string {
  return [
    instruction,
    material.sparse ? LOW_MATERIAL_NOTE : "",
    "",
    metaLines(a),
    "",
    materialBlock(material),
    "",
    'Return ONLY JSON: {"overview": string (1-2 sentences on what this test covers), "sections":[{"title":string,"points":[string],"terms":[{"term":string,"def":string}]}]}',
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildQuestionsPrompt(
  a: AssessmentMeta,
  material: StudyMaterial,
  type: StudyQuestionType,
  count = 6,
  instruction: string = DEFAULT_STUDY_QUESTIONS_INSTRUCTION,
): string {
  const shape =
    type === "multiple_choice"
      ? '{"prompt":string,"choices":[string,string,string,string],"answer":<index 0-3>,"explanation":string}'
      : type === "true_false"
        ? '{"prompt":string,"answer":true|false,"explanation":string}'
        : '{"prompt":string,"acceptable":[2-5 short answer phrasings],"modelAnswer":string,"explanation":string}';
  return [
    instruction,
    `Write ${count} ${type.replace("_", " ")} questions a student should be able to answer before this assessment.`,
    type === "short_answer"
      ? "`acceptable` must be SHORT key phrases a correct answer would contain (they are matched mechanically against the student's words), not full sentences."
      : "",
    material.sparse ? LOW_MATERIAL_NOTE : "",
    "",
    metaLines(a),
    "",
    materialBlock(material),
    "",
    `Return ONLY a JSON array of ${count} objects: ${shape}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------- Gemini call + parsers (fail soft) ----------

export type StudyGenError = { ok: false; reason: "no_key" | "timeout" | "http_error" | "bad_response" };

async function callGemini(
  prompt: string,
  maxOutputTokens: number,
  temperature = 0.5, // the relevance check runs colder (0.1) than the writers
): Promise<{ ok: true; json: unknown } | StudyGenError> {
  const key = geminiKey();
  if (!key) return { ok: false, reason: "no_key" };
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature, maxOutputTokens, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
  };
  // Shared retry helper: backs off through transient 429/503/network blips (study
  // generation previously gave up on the first failure).
  const { res, timedOut } = await geminiPost(`${GEMINI_URL}?key=${encodeURIComponent(key)}`, body, { timeoutMs: TIMEOUT_MS });
  if (timedOut) return { ok: false, reason: "timeout" };
  if (!res || !res.ok) return { ok: false, reason: "http_error" };
  const json = await res.json().catch(() => null);
  if (json === null) return { ok: false, reason: "bad_response" };
  return { ok: true, json };
}

function parseJsonText(json: unknown): unknown {
  const text = extractGeminiText(json);
  if (!text) return null;
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const strList = (v: unknown, maxItems: number, maxLen: number): string[] =>
  Array.isArray(v)
    ? v
        .map((x) => str(x, maxLen))
        .filter((x): x is string => x !== null)
        .slice(0, maxItems)
    : [];

export function parsePlanContent(raw: unknown, allowedDates: Set<string>): Pick<StudyPlanContent, "advice" | "sessions"> | null {
  if (!raw || typeof raw !== "object") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = raw as any;
  const advice = str(r.advice, 600) ?? "";
  const sessions: Omit<PlanSession, "hours">[] = [];
  if (Array.isArray(r.sessions)) {
    for (const el of r.sessions) {
      if (!el || typeof el !== "object") continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = el as any;
      const date = str(e.date, 10);
      if (!date || !allowedDates.has(date)) continue; // the model may not invent sessions
      sessions.push({
        date,
        focus: str(e.focus, 160) ?? "Review",
        techniques: strList(e.techniques, 4, 40),
        activities: strList(e.activities, 5, 160),
      });
    }
  }
  if (!advice && sessions.length === 0) return null;
  return { advice, sessions: sessions as PlanSession[] };
}

export function parseGuideContent(raw: unknown): Pick<StudyGuideContent, "overview" | "sections"> | null {
  if (!raw || typeof raw !== "object") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = raw as any;
  const sections: GuideSection[] = [];
  if (Array.isArray(r.sections)) {
    for (const el of r.sections) {
      if (!el || typeof el !== "object") continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = el as any;
      const title = str(e.title, 120);
      const points = strList(e.points, 8, 300);
      if (!title || points.length === 0) continue;
      const terms = Array.isArray(e.terms)
        ? e.terms
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((t: any) => ({ term: str(t?.term, 80), def: str(t?.def, 240) }))
            .filter((t: { term: string | null; def: string | null }): t is { term: string; def: string } => !!t.term && !!t.def)
            .slice(0, 8)
        : [];
      sections.push({ title, points, terms });
    }
  }
  if (sections.length === 0) return null;
  return { overview: str(r.overview, 400) ?? "", sections: sections.slice(0, 8) };
}

export function parseQuestionsContent(raw: unknown, type: StudyQuestionType): StudyQuestion[] | null {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? Object.values(raw as Record<string, unknown>).find(Array.isArray)
      : null;
  if (!Array.isArray(list)) return null;
  const out: StudyQuestion[] = [];
  for (const el of list) {
    if (!el || typeof el !== "object") continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = el as any;
    const prompt = str(e.prompt, 500);
    const explanation = str(e.explanation, 500) ?? "";
    if (!prompt) continue;
    if (type === "multiple_choice") {
      const choices = strList(e.choices, 4, 200);
      const answer = Number(e.answer);
      if (choices.length < 2 || !Number.isInteger(answer) || answer < 0 || answer >= choices.length) continue;
      out.push({ kind: "multiple_choice", prompt, choices, answer, explanation });
    } else if (type === "true_false") {
      if (typeof e.answer !== "boolean") continue;
      out.push({ kind: "true_false", prompt, answer: e.answer, explanation });
    } else {
      const acceptable = strList(e.acceptable, 5, 80);
      const modelAnswer = str(e.modelAnswer, 300);
      if (acceptable.length === 0 || !modelAnswer) continue;
      out.push({ kind: "short_answer", prompt, acceptable, modelAnswer, explanation });
    }
  }
  return out.length >= 3 ? out.slice(0, 8) : null;
}

// ---------- top-level generators (called by /api/study) ----------

export async function generateStudyPlan(
  a: AssessmentMeta,
  sessions: { date: string; hours: number }[],
  instruction?: string,
): Promise<{ ok: true; content: StudyPlanContent } | StudyGenError> {
  const res = await callGemini(buildPlanPrompt(a, sessions, instruction ?? DEFAULT_STUDY_PLAN_INSTRUCTION), 1600);
  if (!res.ok) return res;
  const parsed = parsePlanContent(parseJsonText(res.json), new Set(sessions.map((s) => s.date)));
  if (!parsed) return { ok: false, reason: "bad_response" };
  // Re-attach the deterministic hours and original order; drop model dupes.
  const byDate = new Map(parsed.sessions.map((s) => [s.date, s]));
  const aligned: PlanSession[] = sessions.map((s, i) => {
    const m = byDate.get(s.date) ?? parsed.sessions[i];
    return {
      date: s.date,
      hours: s.hours,
      focus: m?.focus ?? "Review the material",
      techniques: m?.techniques ?? [],
      activities: m?.activities ?? [],
    };
  });
  return { ok: true, content: { advice: parsed.advice, sessions: aligned } };
}

export async function generateStudyGuide(
  a: AssessmentMeta,
  material: StudyMaterial,
  instruction?: string,
): Promise<{ ok: true; content: StudyGuideContent } | StudyGenError> {
  const res = await callGemini(buildGuidePrompt(a, material, instruction ?? DEFAULT_STUDY_GUIDE_INSTRUCTION), 3000);
  if (!res.ok) return res;
  const parsed = parseGuideContent(parseJsonText(res.json));
  if (!parsed) return { ok: false, reason: "bad_response" };
  return {
    ok: true,
    content: { ...parsed, sparse: material.sparse, sources: material.sources.map((s) => s.title), excluded: material.excluded },
  };
}

export async function generateStudyQuestions(
  a: AssessmentMeta,
  material: StudyMaterial,
  type: StudyQuestionType,
  instruction?: string,
): Promise<{ ok: true; content: StudyQuestionsContent } | StudyGenError> {
  const res = await callGemini(buildQuestionsPrompt(a, material, type, 6, instruction ?? DEFAULT_STUDY_QUESTIONS_INSTRUCTION), 2600);
  if (!res.ok) return res;
  const questions = parseQuestionsContent(parseJsonText(res.json), type);
  if (!questions) return { ok: false, reason: "bad_response" };
  return {
    ok: true,
    content: { type, questions, sparse: material.sparse, sources: material.sources.map((s) => s.title), excluded: material.excluded },
  };
}
