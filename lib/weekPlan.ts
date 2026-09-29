// v1 week scheduler (docs/navo-scheduling-v1-spec.md). Produces the same `Plan`
// shape as generatePlan, but the work is laid out per the spec:
//  • assessments → spaced ≤1h bell sessions (review then relearn), via lib/studyPlan
//  • deliverables → ≤1h chunks across the days before they're due
//  • placement: VALUE-FIRST — highest marginal value first (contention), each on its
//    target day for spacing, under 90% of the daily budget. Deadlines are a HARD
//    CONSTRAINT (nothing is placed past its due/exam day) but NOT a guarantee — this
//    is not EDF, so under genuine over-capacity a lower-value item may be left
//    unplaced and surfaces as overload rather than getting crammed in.
// Pure + deterministic given `now` + `zone`. The legacy generatePlan stays for back-compat.
//
// DAYS are the STUDENT's (lib/studentZone): every day index, PlanDay.date/weekday/
// isToday and the past-due cutoff read `now` and each deadline in `zone`, never the
// server's zone (UTC on Vercel put a Wed 11:59 PM deadline on Thursday). An item is
// past due only once its due DAY has passed in that zone.
//
// EFFORT arrives resolved (lib/effort.effortOrDefault: AI estimate padded once, or
// the student's number as typed) and is budgeted exactly — an item's blocks sum to
// the effort its tag shows (lib/effort.roundHours precision).
//
// STUDY: a block is `study: true` only when it is a real, placed session (> 0h).
// The due-day G1 marker is `marker: true, study: false` — lib/studyWeek.
// isStudySessionBlock is THE "is this a study session" rule (#143).
//
// ACCOUNTING (per in-window item): placed + unplaced + expired = its effort.
//  • placed   = the hours in its blocks (each ≤ MAX_BLOCK — never merged past it)
//  • unplaced = work that didn't fit before its deadline → `Plan.shortfalls` and,
//               summed, `overloadHours` (data only — no "won't fit" alert)
//  • expired  = study for a test that is TODAY: it can no longer happen (study is
//               for the days before a test), so it is neither placed nor overload.

import { addDays, parseYmd, ymd, WEEKDAYS } from "./calendarDates";
import { DEFAULT_STUDENT_ZONE, dayDiffInZone, todayInZone } from "./studentZone";
import { roundHours } from "./effort";
import {
  expandAssessment,
  chunkDeliverable,
  DAILY_HEADROOM,
  MAX_BLOCK,
  type AssessmentTier,
  type SessionKind,
} from "./studyPlan";
import type { Plan, PlanDay, AtRiskItem, UndatedItem, SchedulerAssignment } from "./scheduler";

const EPS = 1e-9;

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
  zone: string = DEFAULT_STUDENT_ZONE,
): Plan {
  const days = Math.max(1, Math.floor(windowDays));
  const H = Math.max(0, hoursPerDay);
  const E = Math.max(0, effortHours);
  const cap = H * DAILY_HEADROOM; // schedule to 90% of the budget (spec §6)

  // Day 0 = today in the student's zone; `startDay` is that calendar day as a local
  // midnight, used ONLY for calendar arithmetic (date/weekday labels), never instants.
  const startDay = parseYmd(todayInZone(zone, now));
  const dayIndex = (d: Date) => dayDiffInZone(d, zone, now);

  const undated: UndatedItem[] = [];
  const overdue: SchedulerAssignment[] = [];
  const units: Unit[] = [];
  const inWindowDue = new Set<number>(); // items whose deadline lands in the window (the G1 set)
  let beyondWindowCount = 0;
  const unplaced = new Map<number, number>(); // canvasId → hours that didn't fit (the shortfall)
  const addUnplaced = (id: number, h: number) => {
    if (h > EPS) unplaced.set(id, (unplaced.get(id) ?? 0) + h);
  };

  for (const a of assignments) {
    if (!a.dueAt) {
      undated.push({ canvasId: a.canvasId, name: a.name, courseName: a.courseName, pointsPossible: a.pointsPossible, htmlUrl: a.htmlUrl });
      continue;
    }
    const due = dayIndex(a.dueAt);
    if (due < 0) {
      overdue.push(a); // the due DAY has passed in the student's zone
      continue;
    }
    // Resolved effort (lib/effort.effortOrDefault upstream); E only if a caller passed none.
    const effort = a.estimatedEffortHours != null && a.estimatedEffortHours >= 0 ? a.estimatedEffortHours : E;
    const isStudy = a.assessmentTier != null;

    if (isStudy) {
      if (due === 0) {
        // The test is today: its study time has expired (not placed, not overload).
        // It still appears — as its due-day marker (G1, below).
        inWindowDue.add(a.canvasId);
        continue;
      }
      // Expand into spaced sessions (honoring the user's study-lead window); place
      // only those whose target day is in-window. (The window never reaches before
      // today when the test is ≥ 1 day out: effectiveWindow ≤ daysUntil.)
      const plan = expandAssessment({ daysUntil: due, studyHours: effort, tier: a.assessmentTier as AssessmentTier, leadDays: a.studyLeadDays });
      for (const s of plan.sessions) {
        const target = due - s.dayOffset;
        if (target < 0 || target >= days) continue; // before today (expired) or a later week
        // Floor = the spacing endpoints (review + day-before): kept when an exam's
        // interior sessions overflow, so compression preserves the spacing.
        const isFloor = s.index === 1 || s.index === plan.sessions.length;
        units.push({ a, hours: s.hours, targetDay: target, deadlineDay: due, isStudy: true, isFloor, sessionKind: s.kind });
      }
      if (due < days) {
        inWindowDue.add(a.canvasId); // the exam itself is in-window
        addUnplaced(a.canvasId, plan.overflowHours); // prep that can't fit ≤1h sessions → unplaced
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
  // Placed pieces. Same item + day + kind merge into one block, but NEVER past
  // MAX_BLOCK (a 2h "session" breaks the ≤1h rule) — then a new block starts.
  const placed: { unit: Unit; day: number; hours: number }[] = [];
  const openBlock = new Map<string, number>(); // item:day:kind → index into `placed`
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
      addUnplaced(u.a.canvasId, u.hours); // can't fit before its deadline → surfaced, never crammed
      continue;
    }
    remaining[d] -= u.hours;
    planDays[d].allocated += u.hours;
    const key = `${u.a.canvasId}:${d}:${u.sessionKind ?? ""}`;
    const at = openBlock.get(key);
    if (at !== undefined && placed[at].hours + u.hours <= MAX_BLOCK + EPS) placed[at].hours += u.hours;
    else {
      openBlock.set(key, placed.length);
      placed.push({ unit: u, day: d, hours: u.hours });
    }
  }

  for (const { unit, day: d, hours } of placed) {
    if (roundHours(hours) <= 0) continue;
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
      estimatedEffortHours: unit.a.estimatedEffortHours ?? null, // total estimate (for "split across blocks → show total")
    });
    represented.add(unit.a.canvasId); // only an item with a real (>0h) emitted block counts as represented
  }

  // G1: every in-window-due item must appear. Emit a 0h MARKER on its deadline day
  // for anything that got no placed block: a quiz due today (study happens on the
  // days BEFORE a test), zero effort, or fully overloaded out. A marker is never a
  // study session (#143: it read as "Study booked · 0m" on every test day).
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
      study: false,
      marker: true,
      estimatedEffortHours: a.estimatedEffortHours ?? null,
    });
    represented.add(a.canvasId);
  }

  const atRisk: AtRiskItem[] = overdue.map((a) => ({
    canvasId: a.canvasId,
    name: a.name,
    courseName: a.courseName,
    dueAt: a.dueAt!.toISOString(),
    kind: "overdue" as const,
    shortfallHours: roundHours(a.estimatedEffortHours ?? E),
    htmlUrl: a.htmlUrl,
    summary: a.summary ?? null,
  }));

  let totalPlannedHours = 0;
  for (const day of planDays) {
    for (const b of day.blocks) b.hours = roundHours(b.hours);
    day.blocks.sort((x, y) => y.hours - x.hours || x.name.localeCompare(y.name));
    day.allocated = roundHours(day.allocated);
    totalPlannedHours += day.allocated;
  }

  // Per-item unplaced hours (data only — the owner removed "won't fit" alerts as noise).
  const shortfalls = [...unplaced]
    .map(([canvasId, h]) => ({ canvasId, hours: roundHours(h) }))
    .filter((x) => x.hours > 0)
    .sort((x, y) => x.canvasId - y.canvasId);

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
    totalPlannedHours: roundHours(totalPlannedHours),
    overloadHours: roundHours(shortfalls.reduce((s, x) => s + x.hours, 0)),
    shortfalls,
  };
}
