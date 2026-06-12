import { describe, it, expect } from "vitest";
import { gradeShortAnswer, isQuestionType } from "@/lib/studyShared";
import { parsePlanContent, parseGuideContent, parseQuestionsContent, studyHash, stripHtml } from "@/lib/study";

describe("gradeShortAnswer", () => {
  it("accepts a phrase contained in the answer (case/punct-insensitive)", () => {
    expect(gradeShortAnswer("It's the Mitochondria!", ["mitochondria"])).toBe(true);
  });
  it("accepts when all words of a multi-word phrase appear in any order", () => {
    expect(gradeShortAnswer("the cell membrane is selectively permeable", ["selectively permeable membrane"])).toBe(true);
    expect(gradeShortAnswer("supply rises", ["demand increases"])).toBe(false); // a phrase word is missing
  });
  it("rejects empty and wrong answers", () => {
    expect(gradeShortAnswer("", ["anything"])).toBe(false);
    expect(gradeShortAnswer("photosynthesis", ["cellular respiration"])).toBe(false);
  });
});

describe("parseQuestionsContent", () => {
  const mcq = (over: Record<string, unknown> = {}) => ({
    prompt: "Q?",
    choices: ["a", "b", "c", "d"],
    answer: 1,
    explanation: "because",
    ...over,
  });
  it("keeps valid MCQs and drops out-of-range answers", () => {
    const out = parseQuestionsContent([mcq(), mcq({ answer: 9 }), mcq(), mcq()], "multiple_choice");
    expect(out).toHaveLength(3);
  });
  it("returns null below the 3-question floor", () => {
    expect(parseQuestionsContent([mcq(), mcq({ answer: 9 })], "multiple_choice")).toBeNull();
  });
  it("validates short-answer shape (acceptable + modelAnswer required)", () => {
    const sa = { prompt: "Define X", acceptable: ["x"], modelAnswer: "X is …", explanation: "" };
    const out = parseQuestionsContent([sa, sa, sa, { prompt: "bad" }], "short_answer");
    expect(out).toHaveLength(3);
    expect(out?.[0].kind).toBe("short_answer");
  });
  it("tolerates a wrapping object", () => {
    const out = parseQuestionsContent({ questions: [mcq(), mcq(), mcq()] }, "multiple_choice");
    expect(out).toHaveLength(3);
  });
});

describe("parsePlanContent", () => {
  it("drops sessions on dates the scheduler didn't provide (the model may not invent sessions)", () => {
    const raw = {
      advice: "ok",
      sessions: [
        { date: "2026-06-14", focus: "f", techniques: ["recall"], activities: ["a"] },
        { date: "2026-06-20", focus: "invented", techniques: [], activities: [] },
      ],
    };
    const out = parsePlanContent(raw, new Set(["2026-06-14", "2026-06-15"]));
    expect(out?.sessions).toHaveLength(1);
    expect(out?.sessions[0].date).toBe("2026-06-14");
  });
  it("accepts advice-only output (no scheduled blocks)", () => {
    expect(parsePlanContent({ advice: "cram wisely", sessions: [] }, new Set())?.advice).toBe("cram wisely");
  });
});

describe("parseGuideContent", () => {
  it("requires at least one section with points", () => {
    expect(parseGuideContent({ overview: "x", sections: [] })).toBeNull();
    const out = parseGuideContent({
      overview: "x",
      sections: [{ title: "T", points: ["p1"], terms: [{ term: "a", def: "b" }, { term: "", def: "c" }] }],
    });
    expect(out?.sections[0].terms).toHaveLength(1);
  });
});

describe("studyHash / stripHtml", () => {
  it("is stable and input-sensitive", () => {
    expect(studyHash([1, "a", null])).toBe(studyHash([1, "a", null]));
    expect(studyHash([1, "a"])).not.toBe(studyHash([1, "b"]));
  });
  it("stripHtml flattens tags/entities and truncates", () => {
    expect(stripHtml("<p>Hello&nbsp;<b>world</b></p><script>x()</script>", 50)).toBe("Hello world");
  });
});

describe("isQuestionType", () => {
  it("accepts the three types, rejects others", () => {
    expect(isQuestionType("multiple_choice")).toBe(true);
    expect(isQuestionType("essay")).toBe(false);
  });
});
