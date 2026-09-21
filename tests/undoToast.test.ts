// The dashboard's "Marked as done · Undo" window. The toast itself needs a DOM, so
// what's tested here is the bookkeeping it drives (lib/pendingDone) — the settled
// lifecycle, the single refresh signal, pruning, the undo-failure re-hold and the
// held-first slice — plus grep guards that the dashboard is wired to it and that
// the toast is the only clock.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  applyToggle,
  allSettled,
  clearPending,
  isHeld,
  isSettled,
  mergePending,
  prunePending,
  settle,
  toastMessage,
  visibleSlice,
  DONE_MESSAGE,
  UNDO_FAILED_MESSAGE,
  type PendingMap,
} from "@/lib/pendingDone";

type Row = { canvasId: number; name: string };
const row = (canvasId: number, name = `Item ${canvasId}`): Row => ({ canvasId, name });
const empty: PendingMap<Row> = new Map();
const heldIn = (p: PendingMap<Row>) => (id: number) => isHeld(p, id);

describe("pendingDone — holding a checked-off row", () => {
  it("marking done holds the row with its snapshot, un-settled, with the done copy", () => {
    const p = applyToggle(empty, 7, true, row(7));
    expect(isHeld(p, 7)).toBe(true);
    expect(isSettled(p, 7)).toBe(false);
    expect(p.get(7)?.item.name).toBe("Item 7");
    expect(toastMessage(p, 7)).toBe(DONE_MESSAGE);
  });

  it("un-checking inside the window drops the hold, like Undo", () => {
    const back = applyToggle(applyToggle(empty, 7, true, row(7)), 7, false, row(7));
    expect(isHeld(back, 7)).toBe(false);
  });

  it("never mutates the map it was given", () => {
    const p = applyToggle(empty, 7, true, row(7));
    applyToggle(p, 8, true, row(8));
    clearPending(p, 7);
    settle(p, 7);
    expect([...p.keys()]).toEqual([7]);
    expect(isSettled(p, 7)).toBe(false);
  });
});

describe("pendingDone — the settled lifecycle", () => {
  it("expiring settles the row instead of dropping it: still held, toast gone", () => {
    const p = settle(applyToggle(empty, 7, true, row(7)), 7);
    expect(isHeld(p, 7)).toBe(true); // keeps reading as done — no un-strike flash
    expect(isSettled(p, 7)).toBe(true);
    expect(toastMessage(p, 7)).toBeNull(); // the toast is gone
  });

  it("one of two expires → both still held, and NO refresh signal", () => {
    let p: PendingMap<Row> = empty;
    p = applyToggle(p, 1, true, row(1));
    p = applyToggle(p, 2, true, row(2));
    p = settle(p, 1);
    expect(allSettled(p)).toBe(false); // row 2's window is still open
    expect(isHeld(p, 1)).toBe(true);
    expect(isHeld(p, 2)).toBe(true);
    expect(toastMessage(p, 1)).toBeNull();
    expect(toastMessage(p, 2)).toBe(DONE_MESSAGE);
  });

  it("both expire → exactly one refresh signal, on the last one", () => {
    let p: PendingMap<Row> = empty;
    p = applyToggle(p, 1, true, row(1));
    p = applyToggle(p, 2, true, row(2));
    p = settle(p, 1);
    expect(allSettled(p)).toBe(false);
    p = settle(p, 2);
    expect(allSettled(p)).toBe(true);
  });

  it("settling twice is a no-op — a repeat onExpire can't fire a second refresh", () => {
    const once = settle(applyToggle(empty, 7, true, row(7)), 7);
    const twice = settle(once, 7);
    expect([...twice.values()]).toEqual([...once.values()]);
    expect(allSettled(twice)).toBe(true);
  });

  it("an empty map is not a refresh signal", () => {
    expect(allSettled(empty)).toBe(false);
  });

  it("undoing the last open row leaves the already-settled one ready to refresh", () => {
    let p: PendingMap<Row> = empty;
    p = applyToggle(p, 1, true, row(1));
    p = applyToggle(p, 2, true, row(2));
    p = settle(p, 1);
    p = clearPending(p, 2); // student pressed Undo on row 2
    expect(allSettled(p)).toBe(true);
  });
});

describe("pendingDone — held rows survive a refresh", () => {
  it("an open-window row the server no longer sends is merged back in", () => {
    const p = applyToggle(empty, 2, true, row(2));
    const merged = mergePending([row(1), row(3)], p); // refresh dropped the done item
    expect(merged.map((r) => r.canvasId).sort()).toEqual([1, 2, 3]);
    expect(merged.find((r) => r.canvasId === 2)?.name).toBe("Item 2");
  });

  it("a SETTLED row is not merged back — the server's list decides now", () => {
    const p = settle(applyToggle(empty, 2, true, row(2)), 2);
    expect(mergePending([row(1), row(3)], p).map((r) => r.canvasId)).toEqual([1, 3]);
  });

  it("the server's copy wins while the item is still in the list — no duplicate row", () => {
    const p = applyToggle(empty, 2, true, row(2, "stale snapshot"));
    const merged = mergePending([row(1), row(2, "fresh from server")], p);
    expect(merged).toHaveLength(2);
    expect(merged.find((r) => r.canvasId === 2)?.name).toBe("fresh from server");
  });

  it("nothing held → the list is passed through unchanged", () => {
    const items = [row(1), row(2)];
    expect(mergePending(items, empty)).toEqual(items);
  });
});

describe("pendingDone — pruning after the fresh list arrives", () => {
  it("a settled row the fresh list dropped is forgotten", () => {
    const p = settle(applyToggle(empty, 2, true, row(2)), 2);
    expect(prunePending(p, [row(1), row(3)]).size).toBe(0);
  });

  it("a settled row the fresh list still carries stays held (stays struck out)", () => {
    const p = settle(applyToggle(empty, 2, true, row(2)), 2);
    const pruned = prunePending(p, [row(1), row(2)]);
    expect(isHeld(pruned, 2)).toBe(true);
    expect(isSettled(pruned, 2)).toBe(true);
  });

  it("an open window is never pruned, even if the list already dropped the row", () => {
    const p = applyToggle(empty, 2, true, row(2));
    expect(isHeld(prunePending(p, [row(1)]), 2)).toBe(true);
  });

  it("nothing to prune → the SAME map comes back, so no pointless state update", () => {
    const p = applyToggle(empty, 2, true, row(2));
    expect(prunePending(p, [row(1)])).toBe(p);
    expect(prunePending(empty, [row(1)])).toBe(empty);
  });
});

describe("pendingDone — undo failure re-holds the row", () => {
  it("a failed undo puts the row back, un-settled, with the retry copy", () => {
    const first = applyToggle(empty, 7, true, row(7));
    const released = clearPending(first, 7); // optimistic restore while the PATCH is in flight
    expect(isHeld(released, 7)).toBe(false);
    const reheld = applyToggle(released, 7, true, first.get(7)!.item, UNDO_FAILED_MESSAGE);
    expect(isHeld(reheld, 7)).toBe(true);
    expect(isSettled(reheld, 7)).toBe(false); // a fresh window, so Undo can be retried
    expect(toastMessage(reheld, 7)).toBe(UNDO_FAILED_MESSAGE);
    expect(allSettled(reheld)).toBe(false); // …and no refresh while it's open
  });

  it("a re-held row is merged back into the list like any open window", () => {
    const reheld = applyToggle(empty, 7, true, row(7), UNDO_FAILED_MESSAGE);
    expect(mergePending([row(1)], reheld).map((r) => r.canvasId)).toEqual([1, 7]);
  });
});

describe("pendingDone — held rows can't fall off a capped list", () => {
  const list = [row(1), row(2), row(3), row(4), row(5)];

  it("nothing held → a plain slice, order untouched", () => {
    expect(visibleSlice(list, 3, () => false).map((r) => r.canvasId)).toEqual([1, 2, 3]);
  });

  it("a held row sorted last (rank lost on refresh) is pulled into the slice", () => {
    const p = applyToggle(empty, 5, true, row(5));
    expect(visibleSlice(list, 3, heldIn(p)).map((r) => r.canvasId)).toEqual([5, 1, 2]);
  });

  it("a settled row is still shown — it's held until the server drops it", () => {
    const p = settle(applyToggle(empty, 4, true, row(4)), 4);
    expect(visibleSlice(list, 3, heldIn(p)).map((r) => r.canvasId)).toEqual([4, 1, 2]);
  });

  it("more held rows than the slice has room for → the slice grows, none are lost", () => {
    let p: PendingMap<Row> = empty;
    for (const id of [2, 3, 4, 5]) p = applyToggle(p, id, true, row(id));
    expect(visibleSlice(list, 3, heldIn(p)).map((r) => r.canvasId)).toEqual([2, 3, 4, 5]);
  });

  it("a short list is left alone", () => {
    expect(visibleSlice([row(1)], 3, () => true).map((r) => r.canvasId)).toEqual([1]);
  });
});

// ── Wiring guards: the dashboard must use the undo path, the toast must be the only
// clock, and DoneCheck's default (CoursePage and friends) must stay as it was. ────
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("dashboard wiring", () => {
  const dash = read("components/DashboardView.tsx");

  it("DashboardView renders UndoToast and defers DoneCheck's refresh", () => {
    expect(dash).toContain('from "@/components/UndoToast"');
    expect(dash).toContain("<UndoToast");
    expect(dash).toContain("deferRefresh");
    expect(dash).toContain("onToggled={undo.onToggled(");
  });

  it("the toast owns the only clock — the dashboard arms no expiry timer", () => {
    expect(dash).not.toContain("setTimeout");
  });

  it("the dashboard settles rows and refreshes only when every window has closed", () => {
    expect(dash).toContain("settle(");
    expect(dash).toContain("if (allSettled(next)) router.refresh();");
    expect(dash).toContain("prunePending(");
  });

  it("the undo bar sits in a persistently-mounted live region", () => {
    expect(dash).toContain('<div role="status" aria-live="polite">');
    // …and the toast doesn't declare a nested one of its own (comments aside).
    expect(read("components/UndoToast.tsx")).not.toMatch(/<\w+[^>]*role="status"/);
  });

  it("the row lists are built held-first so a held row can't drop off the cut", () => {
    expect(dash).toContain("visibleSlice(");
    expect(dash).not.toContain("items.slice(0, 3)");
  });

  it("DoneCheck only skips the refresh when asked to, and reports every toggle", () => {
    const src = read("components/calendar/parts.tsx");
    expect(src).toContain("deferRefresh = false");
    expect(src).toContain("if (!deferRefresh) router.refresh();");
    expect(src).toContain("onToggled?.(canvasId, next);");
  });

  it("surfaces that never asked for an undo window keep the old behaviour", () => {
    const src = read("components/CoursePage.tsx");
    expect(src).not.toContain("deferRefresh");
    expect(src).not.toContain("onToggled");
  });
});
