import { describe, it, expect } from "vitest";
import { MARKETING_BACKLOG } from "@/lib/marketingBacklog";
import { isKanbanStatus, isTicketSize, isBoard, asBoard, BOARDS } from "@/lib/kanban";

describe("board helpers", () => {
  it("knows exactly the two boards", () => {
    expect([...BOARDS]).toEqual(["build", "marketing"]);
    expect(isBoard("build")).toBe(true);
    expect(isBoard("marketing")).toBe(true);
  });
  it("rejects unknown boards and falls back to build", () => {
    for (const b of ["", "Build", "mktg", null, undefined, 1]) expect(isBoard(b as unknown)).toBe(false);
    expect(asBoard("marketing")).toBe("marketing");
    expect(asBoard("nope")).toBe("build");
    expect(asBoard(undefined)).toBe("build");
  });
});

describe("MARKETING_BACKLOG data integrity", () => {
  it("every ticket uses a valid column and size", () => {
    for (const t of MARKETING_BACKLOG) {
      expect(isKanbanStatus(t.status), `status for "${t.title}"`).toBe(true);
      expect(isTicketSize(t.size), `size for "${t.title}"`).toBe(true);
    }
  });

  it("every ticket has a non-empty title and scope", () => {
    for (const t of MARKETING_BACKLOG) {
      expect(t.title.trim().length, `title #${t.number}`).toBeGreaterThan(0);
      expect(t.scope.trim().length, `scope #${t.number}`).toBeGreaterThan(0);
    }
  });

  it("ticket numbers are unique and contiguous from 1", () => {
    const nums = MARKETING_BACKLOG.map((t) => t.number).sort((a, b) => a - b);
    expect(new Set(nums).size).toBe(nums.length); // all unique
    expect(nums).toEqual(Array.from({ length: nums.length }, (_, i) => i + 1)); // 1..N
  });

  it("carries the five already-done tickets", () => {
    const done = MARKETING_BACKLOG.filter((t) => t.status === "done").map((t) => t.title);
    expect(done).toContain("Build the marketing website");
    expect(done.length).toBeGreaterThanOrEqual(5);
  });
});
