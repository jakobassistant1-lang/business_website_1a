// THE Plan-list grouping (#135) and the client half of THE Focus rule. Pure,
// node-free, type-only imports of server modules — safe in the client bundle.
//
// FOCUS — owner, verbatim: "focus should be the top priority no matter what that
// is. if the formula gives past due work the top spot, then that is also reflected
// in focus, as it should be for any of the spots beneath the main focus card as
// well." WHICH items may be Focus is decided in ONE place: the ranking module's
// `focusSlice` (lib/rankActive — importance > 0, not unopened, not passive, past
// due included). That module can't be imported here (it reaches lib/latePolicy →
// node crypto + the Gemini fetch, which must never enter the browser bundle), so
// the server pages run it — `focusSlice(data.ranked, Infinity)` — and hand the
// resulting id order down as `focusOrder`. `data.recommendations` is the first
// TOP_N of that same list, and is the fallback when no order was passed (the
// demo). The Dashboard's Focus card + the rows beneath it and the Plan's violet
// row all read `focusItems` over that order — one list everywhere.
//
// PLAN LIST — the SAME importance order inside five groups (Past due → Do next →
// Not open yet → No due date → Graded by your teacher). Each row keeps its GLOBAL
// rank number, so "#3 sits in Past due" is visible at a glance.

import type { CalendarItem } from "./calendarData";
import type { ScoredAssignment } from "./priority";
import { isSettled, mergePending, type PendingMap } from "./pendingDone";

type Ranked = Pick<ScoredAssignment, "canvasId">;
type Item = Pick<CalendarItem, "canvasId" | "status" | "dueAt"> & Partial<Pick<CalendarItem, "locked" | "passive" | "reason">>;

/** `items` in the ranking's order. Items the ranking doesn't carry go last, in
 *  their input order (sort is stable). Never mutates the input. */
export function sortByRank<T extends { canvasId: number }>(items: readonly T[], ranked: readonly Ranked[]): T[] {
  const pos = new Map(ranked.map((r, i) => [r.canvasId, i] as const));
  return [...items].sort((a, b) => (pos.get(a.canvasId) ?? Infinity) - (pos.get(b.canvasId) ?? Infinity) || 0);
}

/** The Focus order to use: the server's full `focusSlice` order when given, else
 *  `data.recommendations` (its first TOP_N). */
export function focusOrderOf(data: { recommendations?: readonly Ranked[] }, focusOrder?: readonly number[] | null): number[] {
  return focusOrder ? [...focusOrder] : (data.recommendations ?? []).map((r) => r.canvasId);
}

/** The top `n` items to work on — `focusOrder` (the ranking module's list) mapped
 *  onto the active items on screen, in that order. Past due included; done items
 *  never. `focusItems(items, order, 1)[0]` is THE Focus item on every surface. */
export function focusItems<T extends Item>(items: readonly T[], focusOrder: readonly number[], n: number): T[] {
  const byId = new Map(items.map((it) => [it.canvasId, it] as const));
  const out: T[] = [];
  for (const id of focusOrder) {
    if (out.length >= n) break;
    const it = byId.get(id);
    if (it && it.status !== "done") out.push(it);
  }
  return out;
}

// ── The Plan list's groups ───────────────────────────────────────────────────────

export type PlanGroupKey = "pastDue" | "doNext" | "notOpen" | "noDate" | "teacher";

/** Display order and headings — the owner's wording ("Past due", never "overdue"). */
export const PLAN_GROUPS: ReadonlyArray<{ key: PlanGroupKey; label: string }> = [
  { key: "pastDue", label: "Past due" },
  { key: "doNext", label: "Do next" },
  { key: "notOpen", label: "Not open yet" },
  { key: "noDate", label: "No due date" },
  { key: "teacher", label: "Graded by your teacher" },
];

/** The groups a student can act on — they make up "N to do". */
const ACTIONABLE: ReadonlySet<PlanGroupKey> = new Set(["pastDue", "doNext", "noDate"]);
export const isActionableGroup = (k: PlanGroupKey): boolean => ACTIONABLE.has(k);

/** Which group an active item belongs to. A teacher-graded (passive) item is never
 *  work — it goes to the bottom group whatever its date (the scheduler skips it, so
 *  it never turns past due). Then Not open yet (can't be worked on whatever its
 *  date says), then past due, then undated; everything else is Do next. */
export function planGroupOf(item: Item): PlanGroupKey {
  if (item.passive) return "teacher";
  if (item.locked) return "notOpen";
  if (item.status === "overdue") return "pastDue";
  if (item.dueAt === null) return "noDate";
  return "doNext";
}

export interface PlanRow<T> {
  item: T;
  /** 1-based importance position across the WHOLE list (every group). */
  rank: number;
}
export interface PlanGroup<T> {
  key: PlanGroupKey;
  label: string;
  rows: PlanRow<T>[];
}
export interface GroupedPlan<T> {
  /** Non-empty groups only, in PLAN_GROUPS order; rows keep importance order. */
  groups: PlanGroup<T>[];
  /** Rows in the actionable groups (Past due + Do next + No due date). */
  toDo: number;
  pastDue: number;
}

/** The Plan list: active (not done) items in importance order, numbered 1..N
 *  globally, then split into the groups. Empty groups are dropped. */
export function groupPlanItems<T extends Item>(items: readonly T[], ranked: readonly Ranked[]): GroupedPlan<T> {
  const active = sortByRank(
    items.filter((it) => it.status !== "done"),
    ranked,
  );
  const buckets = new Map<PlanGroupKey, PlanRow<T>[]>(PLAN_GROUPS.map((g) => [g.key, []]));
  active.forEach((item, i) => buckets.get(planGroupOf(item))!.push({ item, rank: i + 1 }));
  const groups = PLAN_GROUPS.filter((g) => buckets.get(g.key)!.length > 0).map((g) => ({ ...g, rows: buckets.get(g.key)! }));
  const count = (k: PlanGroupKey) => buckets.get(k)!.length;
  return { groups, toDo: count("pastDue") + count("doNext") + count("noDate"), pastDue: count("pastDue") };
}

/** canvasId → the global rank number the Plan list prints. Timeline bars and
 *  agenda rows use it so a number means the same thing on every Plan view. */
export function planRanks(items: readonly Item[], ranked: readonly Ranked[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const g of groupPlanItems(items, ranked).groups) for (const r of g.rows) m.set(r.item.canvasId, r.rank);
  return m;
}

// ── The row's reason, without its date ──────────────────────────────────────────

/** The ranking's reason ("Due tomorrow · 70 pts", "Past due · 70 pts", "Opens Oct 3
 *  · 70 pts", "No due date", "Exam Wednesday · 100 pts") minus its leading DATE
 *  phrase — the row states its date once, at the right edge. What's left (points,
 *  "Graded by your teacher", share/weight, "1.5h won't fit") is returned, or null. */
export function reasonDetail(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const parts = reason.split(" · ").map((p) => p.trim()).filter(Boolean);
  if (parts.length > 0 && DATE_PHRASE.test(parts[0])) parts.shift();
  return parts.length > 0 ? parts.join(" · ") : null;
}
const DATE_PHRASE = /^(?:Due\b|Exam\b|Quiz\b|Opens\b|Past due$|No due date$)/;

// ── The list's check-off behaviour (pure; the component only holds the state) ───

/** While any Undo window is open the list keeps the order it had when the first
 *  row was checked (`frozen`), so a refresh from elsewhere (auto-sync) can't move a
 *  held row; once every window has closed, the live order returns. */
export function orderDuringUndo<P, S>(pending: PendingMap<P>, frozen: S | null, current: S): S {
  return frozen && hasOpenWindow(pending) ? frozen : current;
}

/** Any held row whose Undo window is still open? */
export function hasOpenWindow<P>(pending: PendingMap<P>): boolean {
  for (const row of pending.values()) if (!row.settled) return true;
  return false;
}

export interface PlanListView<T> {
  groups: PlanGroup<T>[];
  /** Header counts, same filters as the groups, minus rows whose window has closed
   *  (they're done; they just haven't left the screen yet). */
  toDo: number;
  pastDue: number;
  /** Row count per group, on the same rule. */
  counts: Partial<Record<PlanGroupKey, number>>;
  /** THE Focus item's id (the violet row), if any. */
  focusId: number | undefined;
}

/** What the Plan list renders: the server's items ∪ the rows held in an Undo
 *  window (lib/pendingDone), grouped in `ranked` order, counted, with the Focus id.
 *  Pass the result of `orderDuringUndo` for `ranked` / `focusOrder`. */
export function planListView<T extends Item>(input: { items: readonly T[]; ranked: readonly Ranked[]; focusOrder: readonly number[]; pending: PendingMap<T> }): PlanListView<T> {
  const live = mergePending(input.items, input.pending);
  const { groups } = groupPlanItems(live, input.ranked);
  const counts: Partial<Record<PlanGroupKey, number>> = {};
  for (const g of groups) counts[g.key] = g.rows.filter((r) => !isSettled(input.pending, r.item.canvasId)).length;
  const toDo = PLAN_GROUPS.filter((g) => isActionableGroup(g.key)).reduce((s, g) => s + (counts[g.key] ?? 0), 0);
  return { groups, toDo, pastDue: counts.pastDue ?? 0, counts, focusId: focusItems(live, input.focusOrder, 1)[0]?.canvasId };
}
