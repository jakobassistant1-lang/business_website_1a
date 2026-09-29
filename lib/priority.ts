// Deterministic assignment weighting / prioritization (FR — recommendations).
//
// Pure logic, NOT the LLM: scores every in-window/overdue assignment so the app
// can recommend what to tackle first. Reads the scheduler's already-computed
// Plan (single source of truth — never recomputes the schedule) and layers a
// transparent, testable score on top. Additive: it never touches generatePlan
// or its G1 guarantee.

// LEGACY scorer: only lib/plan.ts's loadPlan (the retired Plan view → /api/plan,
// /api/briefing) still calls scoreAssignments / rankRecommendations /
// priorityInputsFromPlan. The live ranking is lib/rankActive (v1 marginal model).
// Its wording and tiebreakers follow the same owner rules (2026-09-28) so the two
// never contradict: "Past due" (never "Overdue"), date words from lib/dueLabel,
// days in the student's zone, ties at 5 significant digits → the shared
// compareTiebreak chain (earlier due, dated first → points → name → canvasId).

import type { Plan, AtRiskKind } from "./scheduler";
import { round1 } from "./round";
import { DEFAULT_STUDENT_ZONE, dayDiffInZone, todayInZone } from "./studentZone";
import { formatDue } from "./dueLabel";
import { compareTiebreak, importanceBucket, sameImportance, type TieKey } from "./marginalPriority";

// Weights sum to 100 so `score` reads like a 0–100 percentage. Tune here.
export const W_URGENCY = 40;
export const W_IMPACT = 25;
export const W_RISK = 25;
export const W_EFFORT = 10;
export const POINTS_REF = 100; // a "full credit" assignment; caps impact at 1
export const SUBMITTED_FACTOR = 0.1; // already-submitted work sinks, never vanishes
export const TOP_N = 3;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export interface PriorityInput {
  canvasId: number;
  name: string;
  courseName: string;
  dueAt: string | null; // ISO; null = undated (excluded from recommendations)
  pointsPossible: number | null;
  htmlUrl: string | null;
  atRisk: boolean;
  atRiskKind: AtRiskKind | null;
  shortfallHours: number; // effort that couldn't be placed before the due date
  scheduledHours: number; // hours the scheduler did place
  submitted: boolean;
}

export interface ScoredAssignment {
  canvasId: number;
  name: string;
  courseName: string;
  htmlUrl: string | null;
  score: number; // 0..100, 1dp — the DISPLAY value (rounded, monotonically capped)
  value?: number; // raw marginal grade-% at stake (uncapped) — the scheduler's contention currency (set by lib/rankActive)
  reason: string; // e.g. "Due tomorrow · 100 pts · 1.5h won't fit"
  /** Unopened by the teacher (importance 0, never scheduled, never in Focus). Set by lib/rankActive. */
  locked?: boolean;
  /** Passive grade (participation): importance 0, never scheduled, never in Focus. Set by lib/rankActive. */
  passive?: boolean;
  // Legacy 4-factor breakdown (old scorer). Optional: the v1 marginal ranker
  // (lib/rankActive) doesn't emit it, and no UI reads it.
  factors?: { urgency: number; impact: number; risk: number; effort: number; submittedPenalty: number };
}

export interface ScoreContext {
  windowDays: number;
  effortHours: number; // the scheduler's per-assignment effort budget (E)
  now?: Date; // injectable for deterministic tests
  zone?: string; // the student's zone (lib/studentZone); days + date words are read in it
}

export interface Recommendations {
  ranked: ScoredAssignment[];
  top: ScoredAssignment[];
}

function daysUntil(dueAtIso: string, now: Date, zone: string): number {
  return dayDiffInZone(dueAtIso, zone, now);
}

function reasonFor(item: PriorityInput, d: number | null, now: Date, zone: string): string {
  const parts: string[] = [];
  if (item.atRiskKind === "overdue" || (d !== null && d < 0)) parts.push("Past due");
  else if (item.dueAt !== null) {
    const label = formatDue(item.dueAt, "countdown", { todayYmd: todayInZone(zone, now), timeZone: zone });
    parts.push(`Due ${label === "Today" || label === "Tomorrow" ? label.toLowerCase() : label}`);
  }
  if (item.pointsPossible !== null) parts.push(`${item.pointsPossible} pts`);
  if (item.atRiskKind === "insufficient_time" && item.shortfallHours > 0) {
    parts.push(`${item.shortfallHours}h won't fit`);
  }
  return parts.join(" · ");
}

export function scoreAssignments(items: PriorityInput[], ctx: ScoreContext): ScoredAssignment[] {
  const now = ctx.now ?? new Date();
  const zone = ctx.zone ?? DEFAULT_STUDENT_ZONE;
  const windowDays = Math.max(1, ctx.windowDays);
  const effortHours = Math.max(0.0001, ctx.effortHours); // guard /0

  return items.map((item) => {
    const d = item.dueAt ? daysUntil(item.dueAt, now, zone) : null;
    const urgency = d === null ? 0 : d < 0 ? 1 : clamp(1 - d / windowDays, 0, 1);
    const impact = clamp((item.pointsPossible ?? 0) / POINTS_REF, 0, 1);
    const risk =
      item.atRiskKind === "overdue"
        ? 1
        : item.atRiskKind === "insufficient_time"
          ? clamp(item.shortfallHours / effortHours, 0, 1)
          : 0;
    const effort = clamp(item.scheduledHours / effortHours, 0, 1);

    const raw = W_URGENCY * urgency + W_IMPACT * impact + W_RISK * risk + W_EFFORT * effort;
    const submittedFactor = item.submitted ? SUBMITTED_FACTOR : 1;
    const score = round1(raw * submittedFactor);

    return {
      canvasId: item.canvasId,
      name: item.name,
      courseName: item.courseName,
      htmlUrl: item.htmlUrl,
      score,
      reason: reasonFor(item, d, now, zone),
      factors: {
        urgency: round1(urgency),
        impact: round1(impact),
        risk: round1(risk),
        effort: round1(effort),
        submittedPenalty: submittedFactor,
      },
    };
  });
}

export function rankRecommendations(items: PriorityInput[], ctx: ScoreContext): Recommendations {
  const byId = new Map(items.map((i) => [i.canvasId, i]));
  const ranked = scoreAssignments(items, ctx).sort((a, b) => {
    // The owner's tiebreak chain — THE comparator (lib/marginalPriority.compareTiebreak),
    // a strict total order — fed what this legacy input has: due instant (dated
    // before undated), raw points, course, name, canvasId. No grade share / course
    // grade here, so those steps are equal and fall through.
    if (!sameImportance(a.score, b.score)) return importanceBucket(b.score) > importanceBucket(a.score) ? 1 : -1;
    const key = (s: ScoredAssignment): TieKey => {
      const i = byId.get(s.canvasId);
      return {
        canvasId: s.canvasId,
        name: s.name,
        dueAtMs: i?.dueAt ? new Date(i.dueAt).getTime() : null,
        share: null,
        courseGrade: null,
        courseName: s.courseName,
        points: i?.pointsPossible ?? null,
      };
    };
    return compareTiebreak(key(a), key(b));
  });
  return { ranked, top: ranked.slice(0, TOP_N) };
}

/**
 * Build the scorer's inputs from a computed Plan. The Plan classifies every
 * assignment into days[].blocks (scheduled) and atRisk[] (overdue /
 * insufficient_time), which is the urgency + risk + effort signal. Points are
 * threaded in separately because the scheduler drops pointsPossible from its
 * output (see ARCH note). Undated items are excluded (no due-date urgency).
 */
export function priorityInputsFromPlan(
  plan: Plan,
  submittedIds: Set<number>,
  pointsById: Map<number, number | null>,
): PriorityInput[] {
  const map = new Map<number, PriorityInput>();
  const ensure = (
    canvasId: number,
    base: Pick<PriorityInput, "name" | "courseName" | "dueAt" | "htmlUrl">,
  ): PriorityInput => {
    let cur = map.get(canvasId);
    if (!cur) {
      cur = {
        canvasId,
        name: base.name,
        courseName: base.courseName,
        dueAt: base.dueAt,
        htmlUrl: base.htmlUrl,
        pointsPossible: pointsById.get(canvasId) ?? null,
        atRisk: false,
        atRiskKind: null,
        shortfallHours: 0,
        scheduledHours: 0,
        submitted: submittedIds.has(canvasId),
      };
      map.set(canvasId, cur);
    }
    return cur;
  };

  for (const day of plan.days) {
    for (const b of day.blocks) {
      const cur = ensure(b.canvasId, { name: b.name, courseName: b.courseName, dueAt: b.dueAt, htmlUrl: b.htmlUrl });
      cur.scheduledHours = round1(cur.scheduledHours + b.hours);
    }
  }
  for (const a of plan.atRisk) {
    const cur = ensure(a.canvasId, { name: a.name, courseName: a.courseName, dueAt: a.dueAt, htmlUrl: a.htmlUrl });
    cur.atRisk = true;
    cur.atRiskKind = a.kind;
    cur.shortfallHours = a.shortfallHours;
  }
  return [...map.values()];
}
