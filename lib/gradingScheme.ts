// A course's GRADING SCHEME as the syllabus states it (#144) — read by the same
// batched Gemini call that reads the late policy (lib/latePolicy) and stored on
// Course.gradingScheme. It feeds step 2/3 of the grade-share order in
// lib/gradeWeight.gradeShareFor: Canvas weighted groups → syllabus categories →
// syllabus point total → posted points (≥ 5 items) → type default.
//
// Pure and defensive: `parseGradingScheme` accepts anything (Gemini output or the
// stored JSON) and never throws; `matchCategory` only answers when it is sure.

import type { ItemType } from "./itemType";

export interface GradingCategory {
  name: string;
  /** Share of the final grade, 0..1. */
  weight: number;
  /** Items expected in this category over the WHOLE course (from the syllabus). */
  count?: number;
}

export interface GradingScheme {
  totalPoints?: number;
  categories?: GradingCategory[];
}

const MAX_NAME = 80;
const MAX_CATEGORIES = 30;
const MAX_COUNT = 500;

/** A finite number from a number or a numeric string ("20", "20%", " 0.2 "). */
function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.trim().replace(/%$/, "").trim());
    return v.trim() !== "" && Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Validate a raw grading scheme. Returns null when nothing usable is in it.
 *  - totalPoints: kept only when a positive finite number.
 *  - categories: each needs a non-empty name and a positive weight; `count` is
 *    kept only as a positive whole number.
 *  - Weights: all decimals (0.2) or all percents (20 → 0.2). MIXED units — a
 *    weight above 1 next to one below 1 ([0.5, 0.5, 2]) — are a misread: the
 *    whole scheme is rejected (null) rather than guessed. If the weights sum past
 *    1 (extra credit, rounding) they are scaled so they sum to exactly 1.
 */
export function parseGradingScheme(json: unknown): GradingScheme | null {
  try {
    if (!json || typeof json !== "object" || Array.isArray(json)) return null;
    const r = json as Record<string, unknown>;
    const out: GradingScheme = {};

    const total = toNumber(r.totalPoints);
    if (total != null && total > 0) out.totalPoints = total;

    if (Array.isArray(r.categories)) {
      const raw: GradingCategory[] = [];
      for (const el of r.categories.slice(0, MAX_CATEGORIES)) {
        if (!el || typeof el !== "object") continue;
        const c = el as Record<string, unknown>;
        const name = typeof c.name === "string" ? c.name.trim().slice(0, MAX_NAME) : "";
        const weight = toNumber(c.weight);
        if (!name || weight == null || !(weight > 0)) continue;
        const cat: GradingCategory = { name, weight };
        const count = toNumber(c.count);
        if (count != null && count >= 1) cat.count = Math.min(MAX_COUNT, Math.round(count));
        raw.push(cat);
      }
      if (raw.length > 0) {
        const percents = raw.some((c) => c.weight > 1);
        if (percents && raw.some((c) => c.weight < 1)) return null; // mixed units → not trustworthy
        const scaled = raw.map((c) => ({ ...c, weight: percents ? c.weight / 100 : c.weight }));
        const sum = scaled.reduce((s, c) => s + c.weight, 0);
        out.categories = sum > 1 ? scaled.map((c) => ({ ...c, weight: c.weight / sum })) : scaled;
      }
    }

    return out.totalPoints != null || (out.categories?.length ?? 0) > 0 ? out : null;
  } catch {
    return null;
  }
}

// --- matching an assignment to a syllabus category ---------------------------

type Bucket = "participation" | "discussion" | "lab" | "project" | "quiz" | "exam" | "homework";

/** Keyword families, in the order an ASSIGNMENT is classified (first hit wins):
 *  the specific kinds before the generic "homework/assignment". An ITEM is an
 *  exam only by an explicit exam/test/midterm word or by its type (lib/itemType)
 *  — never by "final" alone ("Final Reflection", "Final Paper" are not exams). */
const BUCKETS: Array<[Bucket, RegExp]> = [
  ["participation", /\b(participation|attendance|engagement|clickers?|in class)\b/],
  ["discussion", /\b(discussions?|forums?|discussion posts?)\b/],
  ["lab", /\b(labs?|laboratory|laboratories)\b/],
  ["project", /\b(projects?|term papers?|research papers?|capstone)\b/],
  ["quiz", /\b(quiz|quizzes)\b/],
  ["exam", /\b(exams?|examinations?|midterms?|mid terms?|tests?)\b/],
  ["homework", /\b(homeworks?|hw|assignments?|problem sets?|psets?|exercises?|worksheets?)\b/],
];
/** A CATEGORY named just "Final" / "Finals" / "Cumulative Final" is the final
 *  exam — unless it names a deliverable ("Final Paper", "Final Project"). */
const CATEGORY_FINAL = /\b(finals?|cumulative)\b/;
const DELIVERABLE = /\b(papers?|projects?|presentations?|reflections?|drafts?|essays?|reports?|proposals?|portfolios?|submissions?)\b/;

const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
/** Crude plural → singular per word ("Quizzes" ↔ "Quiz", "Labs" ↔ "Lab"); applied
 *  to both sides of a comparison, so it only needs to be consistent. */
function singularWord(w: string): string {
  if (w.endsWith("zzes")) return w.slice(0, -3);
  if (w.endsWith("ies") && w.length > 4) return `${w.slice(0, -3)}y`;
  if (/(sses|xes|ches|shes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("ss") || w.length <= 3) return w;
  return w.endsWith("s") ? w.slice(0, -1) : w;
}
const singular = (s: string) => s.split(" ").map(singularWord).join(" ");

function firstBucket(text: string | null | undefined): Bucket | null {
  const t = norm(text ?? "");
  if (!t) return null;
  for (const [b, re] of BUCKETS) if (re.test(t)) return b;
  return null;
}

/** Every family a CATEGORY name belongs to ("Quizzes & Exams" → quiz + exam). */
function categoryBuckets(text: string): Set<Bucket> {
  const t = norm(text);
  const out = new Set(BUCKETS.filter(([, re]) => re.test(t)).map(([b]) => b));
  if (CATEGORY_FINAL.test(t) && !DELIVERABLE.test(t)) out.add("exam");
  return out;
}

/** Only the assessment types are a confident signal on their own (lib/itemType
 *  decides them from explicit words / Canvas's online_quiz); a plain assignment
 *  or "other" says nothing about which category it is in. */
const TYPE_BUCKET: Record<ItemType, Bucket | null> = { exam: "exam", quiz: "quiz", assignment: null, other: null };

/** Of several same-bucket categories, the one whose own name shares a
 *  distinguishing word with the assignment (e.g. "Midterm" vs "Final Exam"). */
function narrow(cands: GradingCategory[], name: string): GradingCategory | null {
  if (cands.length === 1) return cands[0];
  const words = new Set(singular(norm(name)).split(" ").filter((w) => w.length >= 4));
  const catWords = cands.map((c) => new Set(singular(norm(c.name)).split(" ")));
  // A word every candidate shares ("exam" in "Midterm Exam" / "Final Exam") can't tell them apart.
  const distinguishing = (w: string) => !catWords.every((s) => s.has(w));
  const hits = cands.filter((_, i) => [...catWords[i]].some((w) => words.has(w) && distinguishing(w)));
  return hits.length === 1 ? hits[0] : null;
}

/**
 * The syllabus category an assignment belongs to, or null when there is no
 * confident match (the caller then moves to the next step of the share order).
 * 1. The Canvas assignment-group name matches a category name (same words, or
 *    one contains the other: group "Homework Assignments" ↔ "Homework").
 * 2. Keyword family (homework/assignment, quiz, exam/test/midterm, project,
 *    participation, discussion, lab): from the item name, then the item type —
 *    exam/quiz only — then the group name (a plain assignment with no keyword is
 *    NOT assumed to be homework). Several categories in the family → the one
 *    sharing a distinguishing word with the item name ("final" picks "Final
 *    Exam" over "Midterm Exam" once the item is known to be an exam), else null.
 * Returns the category object from `scheme.categories` itself (same reference).
 */
export function matchCategory(
  scheme: GradingScheme | null | undefined,
  item: { groupName?: string | null; name: string; type: ItemType },
): GradingCategory | null {
  const cats = scheme?.categories ?? [];
  if (cats.length === 0) return null;

  // 1. group name ↔ category name
  const g = singular(norm(item.groupName ?? ""));
  if (g) {
    const exact = cats.filter((c) => singular(norm(c.name)) === g);
    if (exact.length === 1) return exact[0];
    const contains = cats.filter((c) => {
      const n = singular(norm(c.name));
      return n.length >= 3 && (` ${g} `.includes(` ${n} `) || ` ${n} `.includes(` ${g} `));
    });
    if (contains.length === 1) return contains[0];
  }

  // 2. keyword family
  const bucket = firstBucket(item.name) ?? TYPE_BUCKET[item.type] ?? firstBucket(item.groupName);
  if (!bucket) return null;
  const inBucket = cats.filter((c) => categoryBuckets(c.name).has(bucket));
  if (inBucket.length === 0) return null;
  return narrow(inBucket, item.name);
}
