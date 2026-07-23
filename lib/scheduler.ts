// FR-9: deterministic, rule-based daily planner.
//
// Headline guarantee (G1): every assignment whose due date falls in the planning
// window is represented in the output — as scheduled work, an AT_RISK flag, or
// both. This is enforced both by construction (every in-window assignment is
// pushed into `days` and/or `atRisk`) AND by a runtime assertion at the end.

import { round1 } from "./round";
import { startOfDay, daysBetween } from "./calendarDates";

const EPS = 1e-9;

export interface SchedulerAssignment {
  canvasId: number;
  name: string;
  courseName: string;
  dueAt: Date | null;
  pointsPossible: number | null;
  htmlUrl: string | null;
  estimatedEffortHours?: number | null; // AI per-assignment effort; falls back to the flat default
  summary?: string | null; // AI one-line summary, carried through to the UI
  // When set, this is study-for-an-assessment: sessions may only be placed within
  // this many days before the due date (exams get a longer lead than quizzes).
  studyLeadDays?: number | null;
  aiImportance?: number | null; // 1-5 AI importance/difficulty; with points, weights time allocation
  // Used by the v1 week scheduler (lib/weekPlan): the assessment tier drives the
  // spaced study sessions; value is the prioritizer's marginal value, for contention.
  assessmentTier?: "quiz" | "exam" | "final" | null;
  value?: number | null;
}

export interface DayBlock {
  canvasId: number;
  name: string;
  courseName: string;
  hours: number;
  htmlUrl: string | null;
  dueAt: string; // ISO
  summary?: string | null;
  study?: boolean; // true = a study session ahead of an exam/quiz (not the work itself)
  sessionKind?: "review" | "relearn"; // v1 week scheduler: review/re-read vs successive relearning
  estimatedEffortHours?: number | null; // the assignment's TOTAL estimated effort (not this block's `hours`) — for display when work is split across blocks
}

export interface PlanDay {
  date: string; // YYYY-MM-DD
  weekday: string;
  isToday: boolean;
  blocks: DayBlock[];
  allocated: number;
  capacity: number;
}

export type AtRiskKind = "overdue" | "insufficient_time";

export interface AtRiskItem {
  canvasId: number;
  name: string;
  courseName: string;
  dueAt: string; // ISO
  kind: AtRiskKind;
  shortfallHours: number; // effort that couldn't be placed before the due date
  htmlUrl: string | null;
  summary?: string | null;
}

export interface UndatedItem {
  canvasId: number;
  name: string;
  courseName: string;
  pointsPossible: number | null;
  htmlUrl: string | null;
}

export interface Plan {
  windowStart: string; // YYYY-MM-DD
  windowEnd: string; // YYYY-MM-DD
  hoursPerDay: number;
  effortHours: number;
  days: PlanDay[];
  atRisk: AtRiskItem[];
  undated: UndatedItem[];
  // G1 accounting:
  inWindowDueCount: number;
  representedCount: number; // MUST equal inWindowDueCount
  // Extra, non-G1 transparency:
  overdueCount: number;
  beyondWindowCount: number;
  totalPlannedHours: number;
  // Hours of work that couldn't be allocated within the daily budget before its
  // deadline — i.e. how much the week is over-subscribed (0 = everything fits).
  overloadHours: number;
}


function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Importance multiplier from the AI's 1-5 difficulty/stakes rating (null → 1).
function importanceMult(v: number | null | undefined): number {
  if (v == null || !Number.isFinite(v)) return 1;
  const x = Math.max(1, Math.min(5, v));
  return 0.6 + (x - 1) * 0.2; // 1→0.6, 3→1.0, 5→1.4
}

interface PlanItem {
  a: SchedulerAssignment;
  dueDayIndex: number;
  startDayIdx: number; // earliest day work may be placed (lead window for study)
  isStudy: boolean;
  weight: number; // sqrt(points) × AI-importance multiplier — drives the slack split
  remaining: number; // effort hours still to allocate
}

export function generatePlan(
  assignments: SchedulerAssignment[],
  hoursPerDay: number,
  windowDays: number,
  effortHours: number,
  now: Date = new Date()
): Plan {
  const days = Math.max(1, Math.floor(windowDays));
  const H = Math.max(0, hoursPerDay);
  const E = Math.max(0, effortHours);

  const startDay = startOfDay(now);
  const windowEndExclusive = addDays(startDay, days); // first day NOT in window

  const undated: UndatedItem[] = [];
  const overdue: SchedulerAssignment[] = [];
  const inWindow: PlanItem[] = [];
  let beyondWindowCount = 0;

  for (const a of assignments) {
    if (!a.dueAt) {
      undated.push({ canvasId: a.canvasId, name: a.name, courseName: a.courseName, pointsPossible: a.pointsPossible, htmlUrl: a.htmlUrl });
      continue;
    }
    const idx = daysBetween(startDay, a.dueAt);
    if (idx < 0) {
      overdue.push(a);
    } else if (idx >= days) {
      beyondWindowCount++;
    } else {
      const isStudy = a.studyLeadDays != null;
      const startDayIdx = isStudy ? Math.max(0, idx - (a.studyLeadDays ?? 0)) : 0;
      const need = a.estimatedEffortHours != null && a.estimatedEffortHours >= 0 ? a.estimatedEffortHours : E;
      const weight = Math.sqrt(Math.max(a.pointsPossible ?? 0, 1)) * importanceMult(a.aiImportance);
      inWindow.push({ a, dueDayIndex: idx, startDayIdx, isStudy, weight, remaining: need });
    }
  }

  // Day skeleton. Capacity is the FULL daily budget — calendar busy-time no longer
  // subtracts, because the hours a student enters are already what they have for
  // schoolwork (net of their life). Calendar events are shown for context only.
  const planDays: PlanDay[] = [];
  for (let d = 0; d < days; d++) {
    const date = addDays(startDay, d);
    planDays.push({ date: ymd(date), weekday: WEEKDAYS[date.getDay()], isToday: d === 0, blocks: [], allocated: 0, capacity: H });
  }

  // Accumulate hours per (item, day); each emits a single merged block.
  const hoursByItemDay = new Map<string, number>();
  const give = (it: PlanItem, d: number, hours: number) => {
    if (hours <= EPS) return;
    const k = `${it.a.canvasId}:${d}`;
    hoursByItemDay.set(k, (hoursByItemDay.get(k) ?? 0) + hours);
    it.remaining -= hours;
    planDays[d].allocated += hours;
  };

  const MIN_STUDY_DAY_BEFORE = 1 / 3; // ~20 min hard floor the day before an exam/quiz
  const floorReserved = new Array<number>(days).fill(0);

  // 1) Study day-before floors — reserved first so a small assessment isn't all
  //    front-loaded with nothing right before the test. Capped so floors can't
  //    exceed a day's budget (which would push allocated past capacity, or — when
  //    they fully consume the day — strand a regular item due that same day).
  for (const it of inWindow) {
    if (!it.isStudy || it.remaining <= EPS) continue;
    const db = it.dueDayIndex - 1;
    if (db < 0 || db < it.startDayIdx) continue;
    const floor = Math.min(MIN_STUDY_DAY_BEFORE, it.remaining, H - floorReserved[db]);
    if (floor <= EPS) continue;
    give(it, db, floor);
    floorReserved[db] += floor;
  }

  // Capacity left per day after floors + a prefix sum, so we can ask "how much
  // capacity is available on days (d .. D]". That makes the deadline floor below
  // CORRECT: it accounts for other items sharing those future days and for the
  // study floors already reserved on them (the old `(dueDayIndex - d) * H` assumed
  // each item owned every future day — letting an important late item starve an
  // earlier deadline that was actually feasible).
  const availCap = floorReserved.map((f) => Math.max(0, H - f));
  const capPrefix = new Array<number>(days + 1).fill(0);
  for (let d = 0; d < days; d++) capPrefix[d + 1] = capPrefix[d] + availCap[d];
  const capAfter = (d: number, throughDay: number) =>
    capPrefix[Math.min(days, throughDay + 1)] - capPrefix[Math.min(days, d + 1)]; // Σ availCap on (d, throughDay]

  // 2) Day by day. The DEADLINE FLOOR is the minimum that must happen today to keep
  //    every deadline feasible — the EDF feasibility test: max over deadlines of
  //    (cumulative remaining work due by D) − (capacity still available before D).
  //    It's placed earliest-deadline-first (EDF is optimal for feasibility). Only
  //    the leftover SLACK is split by IMPORTANCE weight, which can never miss a
  //    deadline because the floor already reserved every deadline-critical hour.
  for (let d = 0; d < days; d++) {
    const cap = availCap[d];
    if (cap <= EPS) continue;
    const active = inWindow.filter((it) => it.startDayIdx <= d && d <= it.dueDayIndex && it.remaining > EPS);
    if (active.length === 0) continue;

    // Earliest deadline first; among equal deadlines, the smaller item first (so a
    // tiny feasible item isn't crowded out by a huge over-capacity one), then id.
    const edf = [...active].sort(
      (x, y) => x.dueDayIndex - y.dueDayIndex || x.remaining - y.remaining || x.a.canvasId - y.a.canvasId,
    );
    let cum = 0;
    let mandatory = 0;
    for (const it of edf) {
      cum += it.remaining;
      mandatory = Math.max(mandatory, cum - capAfter(d, it.dueDayIndex));
    }
    mandatory = Math.max(0, Math.min(cap, mandatory));

    // Place the mandatory hours earliest-deadline-first.
    let m = mandatory;
    for (const it of edf) {
      if (m <= EPS) break;
      const take = Math.min(it.remaining, m);
      give(it, d, take);
      m -= take;
    }

    // Split the remaining capacity by importance weight (capped at each item's need).
    let slack = cap - mandatory;
    let pool = active.filter((it) => it.remaining > EPS);
    let guard = 0;
    while (slack > EPS && pool.length > 0 && guard++ < 64) {
      const totalW = pool.reduce((s, it) => s + it.weight, 0);
      if (!(totalW > 0)) break; // also guards a NaN weight (NaN > 0 is false)
      let given = 0;
      for (const it of pool) {
        const share = Math.min((slack * it.weight) / totalW, it.remaining);
        if (share > EPS) {
          give(it, d, share);
          given += share;
        }
      }
      slack -= given;
      if (given <= EPS) break;
      pool = pool.filter((it) => it.remaining > EPS);
    }
  }

  // Emit blocks; mark representation for the G1 guard.
  const byId = new Map(inWindow.map((it) => [it.a.canvasId, it]));
  const representedInWindow = new Set<number>();
  for (const [k, hours] of hoursByItemDay) {
    if (round1(hours) <= 0) continue; // drop sub-0.05h fragments so they never render as "0m"
    const sep = k.indexOf(":");
    const it = byId.get(Number(k.slice(0, sep)))!;
    planDays[Number(k.slice(sep + 1))].blocks.push({
      canvasId: it.a.canvasId, name: it.a.name, courseName: it.a.courseName, hours,
      htmlUrl: it.a.htmlUrl, dueAt: it.a.dueAt!.toISOString(), summary: it.a.summary ?? null, study: it.isStudy,
    });
    representedInWindow.add(it.a.canvasId);
  }
  // 0h marker so a zero-effort / unallocated item still appears on its due day (G1).
  for (const it of inWindow) {
    if (representedInWindow.has(it.a.canvasId)) continue;
    planDays[it.dueDayIndex].blocks.push({
      canvasId: it.a.canvasId, name: it.a.name, courseName: it.a.courseName, hours: 0,
      htmlUrl: it.a.htmlUrl, dueAt: it.a.dueAt!.toISOString(), summary: it.a.summary ?? null, study: it.isStudy,
    });
    representedInWindow.add(it.a.canvasId);
  }

  // Overload = total effort that couldn't be placed before its deadline.
  let overloadHours = 0;
  for (const it of inWindow) overloadHours += Math.max(0, it.remaining);
  overloadHours = round1(overloadHours);

  const atRisk: AtRiskItem[] = [];

  // Overdue items are surfaced (not scheduled) so nothing silently disappears.
  for (const a of overdue) {
    atRisk.push({
      canvasId: a.canvasId,
      name: a.name,
      courseName: a.courseName,
      dueAt: a.dueAt!.toISOString(),
      kind: "overdue",
      shortfallHours: round1(a.estimatedEffortHours ?? E),
      htmlUrl: a.htmlUrl,
      summary: a.summary ?? null,
    });
  }

  // Round displayed hours; show the biggest block first within each day.
  let totalPlannedHours = 0;
  for (const day of planDays) {
    for (const b of day.blocks) b.hours = round1(b.hours);
    day.blocks.sort((x, y) => y.hours - x.hours || x.name.localeCompare(y.name));
    day.allocated = round1(day.allocated);
    totalPlannedHours += day.allocated;
  }
  totalPlannedHours = round1(totalPlannedHours);

  const inWindowDueCount = inWindow.length;
  const representedCount = representedInWindow.size;

  // G1 RUNTIME GUARD: no in-window due assignment may be omitted.
  if (representedCount !== inWindowDueCount) {
    throw new Error(
      `G1 violation: ${inWindowDueCount} in-window due assignments but only ${representedCount} represented.`
    );
  }

  return {
    windowStart: ymd(startDay),
    windowEnd: ymd(addDays(windowEndExclusive, -1)),
    hoursPerDay: H,
    effortHours: E,
    days: planDays,
    atRisk,
    undated,
    inWindowDueCount,
    representedCount,
    overdueCount: overdue.length,
    beyondWindowCount,
    totalPlannedHours,
    overloadHours,
  };
}
