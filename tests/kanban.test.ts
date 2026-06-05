import { describe, it, expect } from "vitest";
import { isKanbanStatus, toKanbanTask } from "@/lib/kanban";

describe("isKanbanStatus", () => {
  it("accepts the four valid columns", () => {
    for (const s of ["todo", "progress", "review", "done"]) expect(isKanbanStatus(s)).toBe(true);
  });
  it("rejects anything else", () => {
    for (const s of ["", "Todo", "archive", null, undefined, 3]) {
      expect(isKanbanStatus(s as unknown)).toBe(false);
    }
  });
});

describe("toKanbanTask", () => {
  it("keeps a valid status", () => {
    expect(toKanbanTask({ id: 1, title: "x", status: "review", position: 2 }).status).toBe("review");
  });
  it("coerces an unknown status to 'todo' so the card stays visible", () => {
    expect(toKanbanTask({ id: 1, title: "x", status: "weird", position: 0 }).status).toBe("todo");
  });
});
