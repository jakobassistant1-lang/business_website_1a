import { describe, it, expect } from "vitest";
import { cleanCourse, shortCourse } from "@/lib/courseName";

describe("courseName", () => {
  it("cleanCourse strips the Canvas term-code prefix", () => {
    expect(cleanCourse("2025F-05:PRINCIPLES OF MICROECONOMICS")).toBe("PRINCIPLES OF MICROECONOMICS");
    expect(cleanCourse("2026SP-01: PRINCIPLES OF FINANCE")).toBe("PRINCIPLES OF FINANCE");
    expect(cleanCourse("PRINCIPLES OF FINANCE")).toBe("PRINCIPLES OF FINANCE"); // no prefix → unchanged
    expect(cleanCourse("2025F-10:")).toBe("2025F-10:"); // would be empty → keep original
  });
  it("shortCourse takes the first ' · ' segment AND strips the code prefix", () => {
    expect(shortCourse("2025F-05:PRINCIPLES OF MICROECONOMICS")).toBe("PRINCIPLES OF MICROECONOMICS");
    expect(shortCourse("2025F-05:PRINCIPLES OF MICROECONOMICS · Exam · 200 pts")).toBe("PRINCIPLES OF MICROECONOMICS");
    expect(shortCourse("PRINCIPLES OF FINANCE")).toBe("PRINCIPLES OF FINANCE");
  });
});
