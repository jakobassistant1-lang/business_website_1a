// Pending-done bookkeeping for the dashboard's "Undo" window.
//
// When a student checks a row's circle the PATCH goes through immediately, but the
// row must STAY on screen for a few seconds with an Undo bar under it. The dashboard
// therefore keeps a small map of rows it is holding on to, keyed by canvasId.
//
// A held row goes through two phases:
//   • un-settled — the undo window is open: the toast is up, the row is struck out,
//     and a snapshot of the row is merged back into the list so a refresh from
//     anywhere (this window's own, another row's, the auto-sync) can't yank it out.
//   • settled — the window ran out: the toast is gone but the row still reads as
//     done until the server's next render drops it. Settling rather than deleting is
//     what stops a row popping back to un-struck and clickable while OTHER rows are
//     still mid-window (the refresh waits for the last one).
// The refresh fires once, when every held row is settled; `prunePending` then drops
// the settled ids the fresh list no longer carries.
//
// NOTE: no timers live here or in the dashboard — the toast owns the only clock and
// reports back through onExpire. Everything here is pure, so it unit-tests straight
// in the node vitest env.

/** The toast copy for the two states a held row can be in. */
export const DONE_MESSAGE = "Marked as done";
export const UNDO_FAILED_MESSAGE = "Couldn't undo — try again";

export type PendingRow<T> = { item: T; settled: boolean; message: string };
export type PendingMap<T> = ReadonlyMap<number, PendingRow<T>>;

/** A row's done-circle reported a toggle. `done` true → hold the row and open its
 *  undo window; false (the student un-checked inside the window) → drop the hold,
 *  which is exactly what Undo does. Returns a NEW map; never mutates the input. */
export function applyToggle<T>(pending: PendingMap<T>, id: number, done: boolean, item: T, message: string = DONE_MESSAGE): Map<number, PendingRow<T>> {
  const next = new Map(pending);
  if (done) next.set(id, { item, settled: false, message });
  else next.delete(id);
  return next;
}

/** The window ran out. The row stays held — struck out, no toast — until the
 *  server's list stops carrying it. A row that's already settled is left alone, so a
 *  double onExpire can't produce a second refresh. */
export function settle<T>(pending: PendingMap<T>, id: number): Map<number, PendingRow<T>> {
  const cur = pending.get(id);
  const next = new Map(pending);
  if (cur && !cur.settled) next.set(id, { ...cur, settled: true });
  return next;
}

/** Undo (or an un-click) — let the row go right now. Returns a NEW map. */
export function clearPending<T>(pending: PendingMap<T>, id: number): Map<number, PendingRow<T>> {
  const next = new Map(pending);
  next.delete(id);
  return next;
}

/** Held = the row still reads as done on screen, window open or not. */
export function isHeld<T>(pending: PendingMap<T>, id: number): boolean {
  return pending.has(id);
}

export function isSettled<T>(pending: PendingMap<T>, id: number): boolean {
  return pending.get(id)?.settled === true;
}

/** The toast copy while a row's window is open, or null when there's no toast. */
export function toastMessage<T>(pending: PendingMap<T>, id: number): string | null {
  const cur = pending.get(id);
  return cur && !cur.settled ? cur.message : null;
}

/** The refresh signal: every held row has expired, so it's safe to pull the server's
 *  list. False while any window is still open (that row would vanish mid-undo). */
export function allSettled<T>(pending: PendingMap<T>): boolean {
  if (pending.size === 0) return false;
  for (const row of pending.values()) if (!row.settled) return false;
  return true;
}

/** `items` ∪ the snapshots of rows with an OPEN window that the server no longer
 *  sends. Settled rows are deliberately not merged — once the window has closed the
 *  server's list decides whether the row is still there. Live items win (fresher
 *  data); callers sort by rank afterwards, so importance order is unaffected. */
export function mergePending<T extends { canvasId: number }>(items: readonly T[], pending: PendingMap<T>): T[] {
  const seen = new Set(items.map((it) => it.canvasId));
  const extra: T[] = [];
  pending.forEach((row, id) => {
    if (!row.settled && !seen.has(id)) extra.push(row.item);
  });
  return extra.length === 0 ? [...items] : [...items, ...extra];
}

/** After a refresh: forget settled rows the fresh list has dropped (they're off the
 *  screen now). Settled rows the list still carries are kept, so they stay struck out
 *  rather than flashing back to normal. Returns the SAME map when there's nothing to
 *  prune, so callers can skip a pointless state update. */
export function prunePending<T extends { canvasId: number }>(pending: PendingMap<T>, items: readonly T[]): PendingMap<T> {
  const present = new Set(items.map((it) => it.canvasId));
  let drop = false;
  pending.forEach((row, id) => {
    if (row.settled && !present.has(id)) drop = true;
  });
  if (!drop) return pending;
  const next = new Map(pending);
  next.forEach((row, id) => {
    if (row.settled && !present.has(id)) next.delete(id);
  });
  return next;
}

/** The rows a capped list actually shows, held ones first. A refresh mid-window can
 *  drop a held row out of `ranked`, which sorts it last — without this it would fall
 *  off the end of a 3-item slice and take its Undo bar with it. The slice grows if
 *  more rows are held than it has room for. */
export function visibleSlice<T extends { canvasId: number }>(list: readonly T[], size: number, held: (canvasId: number) => boolean): T[] {
  const first: T[] = [];
  const rest: T[] = [];
  for (const it of list) (held(it.canvasId) ? first : rest).push(it);
  if (first.length === 0) return list.slice(0, size);
  return [...first, ...rest].slice(0, Math.max(size, first.length));
}
