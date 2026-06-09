// FR-9: deterministic, rule-based daily planner.
//
// Headline guarantee (G1): every assignment whose due date falls in the planning
// window is represented in the output — as scheduled work, an AT_RISK flag, or
// both. This is enforced both by construction (every in-window assignment is
// pushed into `days` and/or `atRisk`) AND by a runtime assertion at the end.

const MS_PER_DAY = 86_400_000;
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
}

export interface DayBlock {
  canvasId: number;
  name: string;
  courseName: string;
  hours: number;
  htmlUrl: string | null;
  dueAt: string; // ISO
  summary?: string | null;
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
}

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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function generatePlan(
  assignments: SchedulerAssignment[],
  hoursPerDay: number,
  windowDays: number,
  effortHours: number,
  now: Date = new Date(),
  // Busy hours per day (YYYY-MM-DD) from connected calendars — subtracted from
  // that day's study capacity so the plan schedules around real commitments.
  busyHoursByDate: Map<string, number> = new Map()
): Plan {
  const days = Math.max(1, Math.floor(windowDays));
  const H = Math.max(0, hoursPerDay);
  const E = Math.max(0, effortHours);

  const startDay = startOfDay(now);
  const windowEndExclusive = addDays(startDay, days); // first day NOT in window

  // Buckets
  const undated: UndatedItem[] = [];
  const overdue: SchedulerAssignment[] = [];
  const inWindow: { a: SchedulerAssignment; dueDayIndex: number }[] = [];
  let beyondWindowCount = 0;

  for (const a of assignments) {
    if (!a.dueAt) {
      undated.push({
        canvasId: a.canvasId,
        name: a.name,
        courseName: a.courseName,
        pointsPossible: a.pointsPossible,
        htmlUrl: a.htmlUrl,
      });
      continue;
    }
    const dueDay = startOfDay(a.dueAt);
    const idx = Math.round((dueDay.getTime() - startDay.getTime()) / MS_PER_DAY);
    if (idx < 0) {
      overdue.push(a);
    } else if (idx >= days) {
      beyondWindowCount++;
    } else {
      inWindow.push({ a, dueDayIndex: idx });
    }
  }

  // Earliest-deadline-first; tie-break by points desc, then name.
  inWindow.sort((x, y) => {
    const dt = x.a.dueAt!.getTime() - y.a.dueAt!.getTime();
    if (dt !== 0) return dt;
    const px = x.a.pointsPossible ?? -1;
    const py = y.a.pointsPossible ?? -1;
    if (px !== py) return py - px;
    return x.a.name.localeCompare(y.a.name);
  });

  // Day skeleton
  const planDays: PlanDay[] = [];
  for (let d = 0; d < days; d++) {
    const date = addDays(startDay, d);
    const busy = busyHoursByDate.get(ymd(date)) ?? 0;
    planDays.push({
      date: ymd(date),
      weekday: WEEKDAYS[date.getDay()],
      isToday: d === 0,
      blocks: [],
      allocated: 0,
      // Calendar busy-time eats into the day's study budget (never below 0).
      capacity: round1(Math.max(0, H - busy)),
    });
  }

  const atRisk: AtRiskItem[] = [];
  const representedInWindow = new Set<number>();

  // Greedy packing: fill earliest available day up to (and including) the due day.
  for (const { a, dueDayIndex } of inWindow) {
    // AI per-assignment effort when present; otherwise the flat default E.
    let remaining = a.estimatedEffortHours != null && a.estimatedEffortHours >= 0 ? a.estimatedEffortHours : E;
    for (let d = 0; d <= dueDayIndex && remaining > EPS; d++) {
      const avail = planDays[d].capacity - planDays[d].allocated;
      if (avail <= EPS) continue;
      const take = Math.min(avail, remaining);
      planDays[d].blocks.push({
        canvasId: a.canvasId,
        name: a.name,
        courseName: a.courseName,
        hours: take,
        htmlUrl: a.htmlUrl,
        dueAt: a.dueAt!.toISOString(),
        summary: a.summary ?? null,
      });
      planDays[d].allocated += take;
      remaining -= take;
      representedInWindow.add(a.canvasId);
    }
    if (remaining > EPS) {
      atRisk.push({
        canvasId: a.canvasId,
        name: a.name,
        courseName: a.courseName,
        dueAt: a.dueAt!.toISOString(),
        kind: "insufficient_time",
        shortfallHours: round1(remaining),
        htmlUrl: a.htmlUrl,
        summary: a.summary ?? null,
      });
      representedInWindow.add(a.canvasId);
    }
    // Zero/negative effort schedules nothing above; surface a 0h marker on the due
    // day so the assignment is never dropped (G1) and stays visible.
    if (!representedInWindow.has(a.canvasId)) {
      planDays[dueDayIndex].blocks.push({
        canvasId: a.canvasId,
        name: a.name,
        courseName: a.courseName,
        hours: 0,
        htmlUrl: a.htmlUrl,
        dueAt: a.dueAt!.toISOString(),
        summary: a.summary ?? null,
      });
      representedInWindow.add(a.canvasId);
    }
  }

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

  // Round displayed hours.
  let totalPlannedHours = 0;
  for (const day of planDays) {
    for (const b of day.blocks) b.hours = round1(b.hours);
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
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
