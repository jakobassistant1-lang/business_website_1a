import { describe, it, expect } from "vitest";
import { courseColor, pickTextOn } from "@/lib/courseColor";

describe("courseColor", () => {
  it("is deterministic for the same name", () => {
    expect(courseColor("CS 221")).toBe(courseColor("CS 221"));
  });

  it("returns a hex from the palette", () => {
    expect(courseColor("US History")).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("pickTextOn returns a readable foreground", () => {
    expect(pickTextOn("#ffffff")).toBe("#000000"); // dark text on light bg
    expect(pickTextOn("#000000")).toBe("#ffffff"); // light text on dark bg
  });
});
