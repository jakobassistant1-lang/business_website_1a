import { describe, it, expect } from "vitest";
import { itemType, isStudyType, requiresOnlineSubmission } from "@/lib/itemType";

describe("itemType", () => {
  it("classifies exams/midterms/tests (long study lead)", () => {
    expect(itemType(null, "Midterm Exam")).toBe("exam");
    expect(itemType(null, "Exam 2")).toBe("exam");
    expect(itemType(null, "Final Exam")).toBe("exam");
    expect(itemType(null, "Unit Test 1")).toBe("exam");
  });

  it("does NOT treat a 'final project' as an exam", () => {
    expect(itemType("online_upload", "Final project proposal")).toBe("assignment");
  });

  it("classifies quizzes by Canvas type and name", () => {
    expect(itemType("online_quiz", "Week 3 Check-in")).toBe("quiz");
    expect(itemType(null, "Quiz 4")).toBe("quiz");
  });

  it("classifies discussions and external tools as other", () => {
    expect(itemType("discussion_topic", "Intro post")).toBe("other");
    expect(itemType("external_tool", "Lab simulation")).toBe("other");
  });

  it("defaults to assignment", () => {
    expect(itemType("online_upload", "Problem Set 4")).toBe("assignment");
    expect(itemType(null, "Essay outline")).toBe("assignment");
  });

  it("isStudyType is true only for exams and quizzes", () => {
    expect(isStudyType("exam")).toBe(true);
    expect(isStudyType("quiz")).toBe(true);
    expect(isStudyType("assignment")).toBe(false);
    expect(isStudyType("other")).toBe(false);
  });
});

describe("requiresOnlineSubmission", () => {
  it("true for any online submission type", () => {
    expect(requiresOnlineSubmission("online_quiz")).toBe(true);
    expect(requiresOnlineSubmission("online_text_entry,online_upload")).toBe(true);
    expect(requiresOnlineSubmission("discussion_topic")).toBe(true);
  });
  it("false for teacher-entered grade columns (no online submission)", () => {
    expect(requiresOnlineSubmission("none")).toBe(false);
    expect(requiresOnlineSubmission("not_graded")).toBe(false);
    expect(requiresOnlineSubmission(null)).toBe(false);
    expect(requiresOnlineSubmission("")).toBe(false);
  });
  it("⚠️ 'none' covers BOTH non-actionable participation AND in-person exams — so false ≠ skippable", () => {
    // Both an in-person exam and a participation grade report "none"; this helper
    // can't tell them apart on its own (that's the AI screen's job).
    expect(requiresOnlineSubmission("none")).toBe(false); // Participation → genuinely skippable
    expect(requiresOnlineSubmission("none")).toBe(false); // "Exam 1" (in person) → NOT skippable
  });
});
