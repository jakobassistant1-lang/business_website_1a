import { describe, it, expect } from "vitest";
import { itemType } from "@/lib/itemType";

describe("itemType", () => {
  it("classifies quizzes by Canvas submission type", () => {
    expect(itemType("online_quiz", "Week 3 Check-in")).toBe("quiz");
  });

  it("classifies quizzes/tests by name when the type doesn't say so", () => {
    expect(itemType("online_upload", "Midterm Exam")).toBe("quiz");
    expect(itemType(null, "Quiz 4")).toBe("quiz");
    expect(itemType(null, "Final")).toBe("quiz");
  });

  it("classifies discussions and external tools as other", () => {
    expect(itemType("discussion_topic", "Intro post")).toBe("other");
    expect(itemType("external_tool", "Lab simulation")).toBe("other");
  });

  it("defaults to assignment", () => {
    expect(itemType("online_upload", "Problem Set 4")).toBe("assignment");
    expect(itemType(null, "Essay outline")).toBe("assignment");
    expect(itemType("", "Reading response")).toBe("assignment");
  });
});
