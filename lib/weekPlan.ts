// v1 week scheduler (docs/navo-scheduling-v1-spec.md). Produces the same `Plan`
// shape as generatePlan, but the work is laid out per the spec:
//  • assessments → spaced ≤1h bell sessions (review then relearn), via lib/studyPlan
//  • deliverables → ≤1h chunks across the days before they're due
//  • placement: VALUE-FIRST — highest marginal value first (contention), each on its
//    target day for spacing, under 90% of the daily budget. Deadlines are a HARD
//    CONSTRAINT (nothing is placed past its due/exam day) but NOT a guarantee — this
//    is not EDF, so under genuine over-capacity a lower-value item may be left
//    unplaced and surfaces as overload rather than getting crammed in.
// Pure + deterministic given `now`. The legacy generatePlan stays for back-compat.

import { round1 } from "./round";
import {
  expandAssessment,
  chunkDeliverable,
  DAILY_HEADROOM,
  type AssessmentTier,
  type SessionKind,
} from "./studyPlan";
import type { Plan, PlanDay, AtRiskItem, UndatedItem, SchedulerAssignment } from "./scheduler";

const MS_PER_DAY = 86_400_000;
const EPS = 1e-9;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface Unit {
  a: SchedulerAssignment;
  hours: number; // ≤ 1h
  targetDay: number; // preferred day index in [0, windowDays)
  deadlineDay: number; // last day index it may be placed on
  isStudy: boolean;
  isFloor: boolean; // study floor = the review (first) or day-before (last) session — protected under contention
  sessionKind?: SessionKind;
}

/** Find the best day for a unit: its target if there's room, else the nearest
 *  day (earlier preferred) within [0, deadline]. Returns null if nothing fits. */
function findDay(target: number, deadline: number, hours: number, remaining: number[], windowDays: number): number | null {
  const maxDay = Math.min(deadline, windowDays - 1);
  if (maxDay < 0) return null;
  const t = Math.max(0, Math.min(target, maxDay));
  for (let r = 0; r <= windowDays; r++) {
    for (const d of [t - r, t + r]) {
      if (d >= 0 && d <= maxDay && remaining[d] >= hours - EPS) return d;
    }
  }
  return null;
}

export function generateWeekPlan(
  assignments: SchedulerAssignment[],
  hoursPerDay: number,
  windowDays: number,
  effortHours: number,
  now: Date = new Date(),
): Plan {
  const days = Math.max(1, Math.floor(windowDays));
  const H = Math.max(0, hoursPerDay);
  const E = Math.max(0, effortHours);
  const cap = H * DAILY_HEADROOM; // schedule to 90% of the budget (spec §6)

  const startDay = startOfDay(now);
  const dayIndex = (d: Date) => Math.round((startOfDay(d).getTime() - startDay.getTime()) / MS_PER_DAY);

  const undated: UndatedItem[] = [];
  const overdue: SchedulerAssignment[] = [];
  const units: Unit[] = [];
  const inWindowDue = new Set<number>(); // items whose deadline lands in the window (the G1 set)
  let beyondWindowCount = 0;
  let studyOverflowHours = 0; // prep that can't fit into ≤1h spaced sessions (folded into overload)

  for (const a of assignments) {
    if (!a.dueAt) {
      undated.push({ canvasId: a.canvasId, name: a.name, courseName: a.courseName, pointsPossible: a.pointsPossible, htmlUrl: a.htmlUrl });
      continue;
    }
    const due = dayIndex(a.dueAt);
    if (due < 0) {
      overdue.push(a);
      continue;
    }
    const effort = a.estimatedEffortHours != null && a.estimatedEffortHours >= 0 ? a.estimatedEffortHours : E;
    const isStudy = a.assessmentTier != null;

    if (isStudy) {
      // Expand into spaced sessions (honoring the user's study-lead window); place
      // only those whose target day is in-window.
      const plan = expandAssessment({ daysUntil: due, studyHours: effort, tier: a.assessmentTier as AssessmentTier, leadDays: a.studyLeadDays });
      for (const s of plan.sessions) {
        const target = due - s.dayOffset;
        if (target < 0 || target >= days) continue; // session falls outside this week's window
        // Floor = the spacing endpoints (review + day-before): kept when an exam's
        // interior sessions overflow, so compression preserves the spacing.
        const isFloor = s.index === 1 || s.index === plan.sessions.length;
        units.push({ a, hours: s.hours, targetDay: target, deadlineDay: due, isStudy: true, isFloor, sessionKind: s.kind });
      }
      if (due < days) {
        inWindowDue.add(a.canvasId); // the exam itself is in-window
        studyOverflowHours += plan.overflowHours; // prep that can't fit ≤1h sessions → counted as overload
      }
    } else {
      if (due >= days) {
        beyondWindowCount++;
        continue;
      }
      inWindowDue.add(a.canvasId);
      const blocks = chunkDeliverable({ effortHours: effort });
      // Spread the chunks across [0, due]: chunk i targets an even slot before the deadline.
      for (let i = 0; i < blocks.length; i++) {
        const span = Math.max(1, blocks.length);
        const target = blocks.length === 1 ? due : Math.round((i * due) / (span - 1 || 1));
        units.push({ a, hours: blocks[i].hours, targetDay: Math.min(target, due), deadlineDay: due, isStudy: false, isFloor: false });
      }
    }
  }

  const planDays: PlanDay[] = [];
  for (let d = 0; d < days; d++) {
    const date = addDays(startDay, d);
    planDays.push({ date: ymd(date), weekday: WEEKDAYS[date.getDay()], isToday: d === 0, blocks: [], allocated: 0, capacity: H });
  }
  const remaining = planDays.map(() => cap);
  const merged = new Map<string, { unit: Unit; hours: number }>();
  let overloadHours = 0;
  const represented = new Set<number>();

  // VALUE-FIRST placement (spec §8): the goal is to maximize marginal points, so
  // rank every unit — study session OR work chunk — by the prioritizer's marginal
  // value and place the highest first. The LOWEST-value work overflows under crunch
  // regardless of type (so a low-stakes assignment yields to high-stakes exam prep
  // when that nets more points). Urgency is already inside `value`, so imminent work
  // is protected without a special case, and EDF is NOT the selector — deadlines are
  // only a hard placement constraint (findDay never lands past one). Within a single
  // item, floor sessions (the review + day-before endpoints) sort ahead of its
  // interior sessions, so an exam's spacing survives compression. Deterministic.
  // Contention currency = the prioritizer's raw marginal value. NO fall back to
  // pointsPossible (a different, much larger scale that would let an un-valued item
  // dominate); an item with no value sorts last at 0.
  const valueOf = (u: Unit) => u.a.value ?? 0;
  units.sort(
    (x, y) =>
      valueOf(y) - valueOf(x) ||
      Number(y.isFloor) - Number(x.isFloor) ||
      x.targetDay - y.targetDay ||
      x.a.canvasId - y.a.canvasId,
  );

  for (const u of units) {
    const d = findDay(u.targetDay, u.deadlineDay, u.hours, remaining, days);
    if (d === null) {
      overloadHours += u.hours; // can't fit before its deadline → surfaced, never crammed
      continue;
    }
    remaining[d] -= u.hours;
    planDays[d].allocated += u.hours;
    const key = `${u.a.canvasId}:${d}:${u.sessionKind ?? ""}`;
    const cur = merged.get(key);
    if (cur) cur.hours += u.hours;
    else merged.set(key, { unit: u, hours: u.hours });
  }
  overloadHours += studyOverflowHours; // fold in prep that couldn't be packed into sessions

  for (const [key, { unit, hours }] of merged) {
    const d = Number(key.slice(key.indexOf(":") + 1, key.lastIndexOf(":")));
    if (round1(hours) <= 0) continue;
    planDays[d].blocks.push({
      canvasId: unit.a.canvasId,
      name: unit.a.name,
      courseName: unit.a.courseName,
      hours,
      htmlUrl: unit.a.htmlUrl,
      dueAt: unit.a.dueAt!.toISOString(),
      summary: unit.a.summary ?? null,
      study: unit.isStudy,
      sessionKind: unit.sessionKind,
    });
    represented.add(unit.a.canvasId); // only an item with a real (>0h) emitted block counts as represented
  }

  // G1: every in-window-due item must appear. Emit a 0h marker on its deadline
  // day for anything that got no placed block (e.g. fully overloaded out).
  for (const a of assignments) {
    if (!a.dueAt) continue;
    const due = dayIndex(a.dueAt);
    if (due < 0 || due >= days || represented.has(a.canvasId)) continue;
    if (!inWindowDue.has(a.canvasId)) continue;
    planDays[due].blocks.push({
      canvasId: a.canvasId,
      name: a.name,
      courseName: a.courseName,
      hours: 0,
      htmlUrl: a.htmlUrl,
      dueAt: a.dueAt.toISOString(),
      summary: a.summary ?? null,
      study: a.assessmentTier != null,
    });
    represented.add(a.canvasId);
  }

  const atRisk: AtRiskItem[] = overdue.map((a) => ({
    canvasId: a.canvasId,
    name: a.name,
    courseName: a.courseName,
    dueAt: a.dueAt!.toISOString(),
    kind: "overdue" as const,
    shortfallHours: round1(a.estimatedEffortHours ?? E),
    htmlUrl: a.htmlUrl,
    summary: a.summary ?? null,
  }));

  let totalPlannedHours = 0;
  for (const day of planDays) {
    for (const b of day.blocks) b.hours = round1(b.hours);
    day.blocks.sort((x, y) => y.hours - x.hours || x.name.localeCompare(y.name));
    day.allocated = round1(day.allocated);
    totalPlannedHours += day.allocated;
  }

  const inWindowDueCount = inWindowDue.size;
  const representedInWindow = [...inWindowDue].filter((id) => represented.has(id)).length;
  if (representedInWindow !== inWindowDueCount) {
    throw new Error(`G1 violation: ${inWindowDueCount} in-window-due items but ${representedInWindow} represented.`);
  }

  return {
    windowStart: ymd(startDay),
    windowEnd: ymd(addDays(startDay, days - 1)),
    hoursPerDay: H,
    effortHours: E,
    days: planDays,
    atRisk,
    undated,
    inWindowDueCount,
    representedCount: representedInWindow,
    overdueCount: overdue.length,
    beyondWindowCount,
    totalPlannedHours: round1(totalPlannedHours),
    overloadHours: round1(overloadHours),
  };
}
