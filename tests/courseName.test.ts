import { describe, it, expect } from "vitest";
import { cleanCourse, shortCourse } from "@/lib/courseName";

describe("courseName", () => {
  it("cleanCourse strips the Canvas term-code prefix", () => {
    expect(cleanCourse("2025F-05:PRINCIPLES OF MICROECONOMICS")).toBe("PRINCIPLES OF MICROECONOMICS");
    expect(cleanCourse("2026SP-01: PRINCIPLES OF FINANCE")).toBe("PRINCIPLES OF FINANCE");
    expect(cleanCourse("PRINCIPLES OF FINANCE")).toBe("PRINCIPLES OF FINANCE"); // no prefix → unchanged
    expect(cleanCourse("2025F-10:")).toBe("2025F-10:"); // would be empty → keep original
  });
  it("cleanCourse also strips section-suffixed and cross-listed codes (#141 leak audit)", () => {
    expect(cleanCourse("2026F-01A: AI DRIVEN MARKETING")).toBe("AI DRIVEN MARKETING");
    expect(cleanCourse("2026F-01 : MANAGERIAL ACCOUNTING")).toBe("MANAGERIAL ACCOUNTING");
    expect(cleanCourse("2026F-01/02: MANAGERIAL ACCOUNTING")).toBe("MANAGERIAL ACCOUNTING");
    expect(cleanCourse("2026F-01 & 2026F-03:MANAGERIAL ECONOMICS")).toBe("MANAGERIAL ECONOMICS");
    expect(cleanCourse("  2026F-01: Biology")).toBe("Biology");
    // a colon later in a real name is left alone
    expect(cleanCourse("Biology: Cells and Systems")).toBe("Biology: Cells and Systems");
  });
  it("cleanCourse leaves code-LOOKING real titles alone (no over-stripping)", () => {
    expect(cleanCourse("2020s-Era: American History")).toBe("2020s-Era: American History");
    expect(cleanCourse("2026F-01 / Honors: Topic")).toBe("2026F-01 / Honors: Topic");
    expect(cleanCourse("2026F-Intro: Topic")).toBe("2026F-Intro: Topic");
  });
  it("shortCourse takes the first ' · ' segment AND strips the code prefix", () => {
    expect(shortCourse("2025F-05:PRINCIPLES OF MICROECONOMICS")).toBe("PRINCIPLES OF MICROECONOMICS");
    expect(shortCourse("2025F-05:PRINCIPLES OF MICROECONOMICS · Exam · 200 pts")).toBe("PRINCIPLES OF MICROECONOMICS");
    expect(shortCourse("PRINCIPLES OF FINANCE")).toBe("PRINCIPLES OF FINANCE");
  });
});
