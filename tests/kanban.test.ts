import { describe, it, expect } from "vitest";
import { isKanbanStatus, isTicketSize, toKanbanTask, parseTaskFields } from "@/lib/kanban";

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

describe("isTicketSize", () => {
  it("accepts the three valid sizes", () => {
    for (const s of ["small", "medium", "large"]) expect(isTicketSize(s)).toBe(true);
  });
  it("rejects anything else", () => {
    for (const s of ["", "Small", "xl", null, undefined, 2]) {
      expect(isTicketSize(s as unknown)).toBe(false);
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

  it("defaults the new optional fields to null on a legacy row", () => {
    const t = toKanbanTask({ id: 1, title: "x", status: "todo", position: 0 });
    expect(t).toMatchObject({
      description: null,
      dueDate: null,
      category: null,
      ticketSize: null,
      contributor: null,
      creatorName: null,
    });
  });

  it("maps the new fields and derives creatorName from createdBy", () => {
    const t = toKanbanTask({
      id: 2,
      title: "y",
      status: "progress",
      position: 1,
      description: "details",
      dueDate: new Date("2026-06-09T00:00:00.000Z"),
      category: "Design",
      ticketSize: "medium",
      contributor: "Priya Jain",
      createdBy: { fullName: "Grayson Moores" },
    });
    expect(t.description).toBe("details");
    expect(t.dueDate).toBe("2026-06-09T00:00:00.000Z");
    expect(t.category).toBe("Design");
    expect(t.ticketSize).toBe("medium");
    expect(t.contributor).toBe("Priya Jain");
    expect(t.creatorName).toBe("Grayson Moores");
  });

  it("coerces an out-of-range ticketSize to null", () => {
    expect(toKanbanTask({ id: 3, title: "z", status: "todo", position: 0, ticketSize: "huge" }).ticketSize).toBe(null);
  });

  it("normalizes a string dueDate to ISO and drops an invalid one", () => {
    expect(toKanbanTask({ id: 4, title: "a", status: "todo", position: 0, dueDate: "2026-01-15" }).dueDate).toBe(
      "2026-01-15T00:00:00.000Z",
    );
    expect(toKanbanTask({ id: 5, title: "b", status: "todo", position: 0, dueDate: "not-a-date" }).dueDate).toBe(null);
  });
});

describe("parseTaskFields", () => {
  it("returns only the keys present in the body (so unsent fields stay unchanged)", () => {
    expect(parseTaskFields({ title: "x" })).toEqual({});
    expect(parseTaskFields({ category: "Design" })).toEqual({ category: "Design" });
  });

  it("normalizes empty/invalid values to null", () => {
    expect(parseTaskFields({ description: "   ", category: "", contributor: "" })).toEqual({
      description: null,
      category: null,
      contributor: null,
    });
    expect(parseTaskFields({ ticketSize: "xl" })).toEqual({ ticketSize: null });
    expect(parseTaskFields({ dueDate: "" })).toEqual({ dueDate: null });
  });

  it("parses a valid ticketSize, dueDate, and trims text fields", () => {
    const out = parseTaskFields({
      description: "  hello  ",
      ticketSize: "large",
      dueDate: "2026-06-09",
      contributor: "  PJ  ",
    });
    expect(out.description).toBe("hello");
    expect(out.ticketSize).toBe("large");
    expect(out.contributor).toBe("PJ");
    expect(out.dueDate).toBeInstanceOf(Date);
    expect((out.dueDate as Date).toISOString()).toBe("2026-06-09T00:00:00.000Z");
  });

  it("tolerates a non-object body", () => {
    expect(parseTaskFields("garbage")).toEqual({});
    expect(parseTaskFields(null)).toEqual({});
  });
});
