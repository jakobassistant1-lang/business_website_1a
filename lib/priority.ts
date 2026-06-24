// Deterministic assignment weighting / prioritization (FR — recommendations).
//
// Pure logic, NOT the LLM: scores every in-window/overdue assignment so the app
// can recommend what to tackle first. Reads the scheduler's already-computed
// Plan (single source of truth — never recomputes the schedule) and layers a
// transparent, testable score on top. Additive: it never touches generatePlan
// or its G1 guarantee.

import type { Plan, AtRiskKind } from "./scheduler";
import { round1 } from "./round";

// Weights sum to 100 so `score` reads like a 0–100 percentage. Tune here.
export const W_URGENCY = 40;
export const W_IMPACT = 25;
export const W_RISK = 25;
export const W_EFFORT = 10;
export const POINTS_REF = 100; // a "full credit" assignment; caps impact at 1
export const SUBMITTED_FACTOR = 0.1; // already-submitted work sinks, never vanishes
export const TOP_N = 3;

const DAY = 86_400_000;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

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
  reason: string; // e.g. "Due in 1 day · 100 pts · 1.5h won't fit"
  // Legacy 4-factor breakdown (old scorer). Optional: the v1 marginal ranker
  // (lib/rankActive) doesn't emit it, and no UI reads it.
  factors?: { urgency: number; impact: number; risk: number; effort: number; submittedPenalty: number };
}

export interface ScoreContext {
  windowDays: number;
  effortHours: number; // the scheduler's per-assignment effort budget (E)
  now?: Date; // injectable for deterministic tests
}

export interface Recommendations {
  ranked: ScoredAssignment[];
  top: ScoredAssignment[];
}

function daysUntil(dueAtIso: string, now: Date): number {
  return Math.round((startOfDay(new Date(dueAtIso)).getTime() - startOfDay(now).getTime()) / DAY);
}

function reasonFor(item: PriorityInput, d: number | null): string {
  const parts: string[] = [];
  if (item.atRiskKind === "overdue" || (d !== null && d < 0)) parts.push("Overdue");
  else if (d === 0) parts.push("Due today");
  else if (d === 1) parts.push("Due in 1 day");
  else if (d !== null) parts.push(`Due in ${d} days`);
  if (item.pointsPossible !== null) parts.push(`${item.pointsPossible} pts`);
  if (item.atRiskKind === "insufficient_time" && item.shortfallHours > 0) {
    parts.push(`${item.shortfallHours}h won't fit`);
  }
  return parts.join(" · ");
}

export function scoreAssignments(items: PriorityInput[], ctx: ScoreContext): ScoredAssignment[] {
  const now = ctx.now ?? new Date();
  const windowDays = Math.max(1, ctx.windowDays);
  const effortHours = Math.max(0.0001, ctx.effortHours); // guard /0

  return items.map((item) => {
    const d = item.dueAt ? daysUntil(item.dueAt, now) : null;
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
      reason: reasonFor(item, d),
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
    if (b.score !== a.score) return b.score - a.score;
    // Tie-break mirrors the scheduler: earlier due, then higher points, then name.
    const da = byId.get(a.canvasId)?.dueAt ?? null;
    const db = byId.get(b.canvasId)?.dueAt ?? null;
    if (da && db && da !== db) return da < db ? -1 : 1;
    const pa = byId.get(a.canvasId)?.pointsPossible ?? -1;
    const pb = byId.get(b.canvasId)?.pointsPossible ?? -1;
    if (pa !== pb) return pb - pa;
    return a.name.localeCompare(b.name);
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
