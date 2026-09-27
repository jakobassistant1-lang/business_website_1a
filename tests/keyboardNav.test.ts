// lib/keyboardNav.nextIndex — the shared roving-focus rule behind the calendar
// view tabs (components/calendar/parts PeriodToolbar) and the Sidebar account menu.
import { describe, it, expect } from "vitest";
import { nextIndex } from "@/lib/keyboardNav";

describe("nextIndex — horizontal (tabs)", () => {
  it("Right/Left step and wrap at both ends", () => {
    expect(nextIndex("ArrowRight", 0, 3)).toBe(1);
    expect(nextIndex("ArrowRight", 2, 3)).toBe(0);
    expect(nextIndex("ArrowLeft", 1, 3)).toBe(0);
    expect(nextIndex("ArrowLeft", 0, 3)).toBe(2);
  });
  it("Home/End jump to the ends", () => {
    expect(nextIndex("Home", 2, 3)).toBe(0);
    expect(nextIndex("End", 0, 3)).toBe(2);
  });
  it("Up/Down are not navigation keys for tabs", () => {
    expect(nextIndex("ArrowDown", 0, 3)).toBeNull();
    expect(nextIndex("ArrowUp", 0, 3)).toBeNull();
  });
});

describe("nextIndex — vertical (menus)", () => {
  it("Down/Up step and wrap; Left/Right pass through", () => {
    expect(nextIndex("ArrowDown", 0, 4, "vertical")).toBe(1);
    expect(nextIndex("ArrowDown", 3, 4, "vertical")).toBe(0);
    expect(nextIndex("ArrowUp", 0, 4, "vertical")).toBe(3);
    expect(nextIndex("ArrowRight", 0, 4, "vertical")).toBeNull();
  });
  it("Home/End work on either axis", () => {
    expect(nextIndex("Home", 3, 4, "vertical")).toBe(0);
    expect(nextIndex("End", 0, 4, "vertical")).toBe(3);
  });
});

describe("nextIndex — edges", () => {
  it("nothing focused (-1) steps in from the matching end", () => {
    expect(nextIndex("ArrowDown", -1, 4, "vertical")).toBe(0);
    expect(nextIndex("ArrowUp", -1, 4, "vertical")).toBe(3);
  });
  it("a single item wraps onto itself; an empty list never moves", () => {
    expect(nextIndex("ArrowRight", 0, 1)).toBe(0);
    expect(nextIndex("ArrowRight", 0, 0)).toBeNull();
    expect(nextIndex("End", 0, 0)).toBeNull();
  });
  it("other keys pass through", () => {
    for (const k of ["Enter", " ", "Tab", "Escape", "a"]) expect(nextIndex(k, 1, 3)).toBeNull();
  });
});
