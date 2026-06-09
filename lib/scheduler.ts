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
  // When set, this is study-for-an-assessment: sessions may only be placed within
  // this many days before the due date (exams get a longer lead than quizzes).
  studyLeadDays?: number | null;
  aiImportance?: number | null; // 1-5 AI importance/difficulty; with points, weights time allocation
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

// Importance multiplier from the AI's 1-5 difficulty/stakes rating (null → 1).
function importanceMult(v: number | null | undefined): number {
  if (v == null) return 1;
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
    const idx = Math.round((startOfDay(a.dueAt).getTime() - startDay.getTime()) / MS_PER_DAY);
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
  //    front-loaded with nothing right before the test.
  for (const it of inWindow) {
    if (!it.isStudy || it.remaining <= EPS) continue;
    const db = it.dueDayIndex - 1;
    if (db < 0 || db < it.startDayIdx) continue;
    const floor = Math.min(MIN_STUDY_DAY_BEFORE, it.remaining);
    give(it, db, floor);
    floorReserved[db] += floor;
  }

  // 2) Day by day: first guarantee deadlines (a "must-do-today" floor keeps every
  //    item feasible), then split the rest of the day's hours by IMPORTANCE weight
  //    (points × AI difficulty) — so a big essay outpulls a tiny homework that's
  //    merely due a day sooner, while both still finish on time.
  for (let d = 0; d < days; d++) {
    const cap = H - floorReserved[d];
    if (cap <= EPS) continue;
    const active = inWindow.filter((it) => it.startDayIdx <= d && d <= it.dueDayIndex && it.remaining > EPS);
    if (active.length === 0) continue;

    let totalMust = 0;
    const must = new Map<number, number>();
    for (const it of active) {
      const futureCap = (it.dueDayIndex - d) * H; // capacity on its remaining days after today
      const m = Math.max(0, Math.min(it.remaining, it.remaining - futureCap));
      must.set(it.a.canvasId, m);
      totalMust += m;
    }

    if (totalMust >= cap - EPS) {
      // Deadlines collide — can't meet every floor today. Split proportionally to
      // the floors; the unmet remainder stays and surfaces as overload.
      const scale = totalMust > EPS ? cap / totalMust : 0;
      for (const it of active) give(it, d, Math.min(it.remaining, (must.get(it.a.canvasId) ?? 0) * scale));
      continue;
    }

    for (const it of active) give(it, d, must.get(it.a.canvasId) ?? 0);
    let slack = cap - totalMust;
    let pool = active.filter((it) => it.remaining > EPS);
    let guard = 0;
    while (slack > EPS && pool.length > 0 && guard++ < 64) {
      const totalW = pool.reduce((s, it) => s + it.weight, 0);
      if (totalW <= 0) break;
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

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
