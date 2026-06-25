import { describe, it, expect } from "vitest";
import { classifyNote, extractNoteText } from "@/lib/notesExtract";
import { buildGuidePrompt, type AssessmentMeta, type StudyMaterial } from "@/lib/study";

const meta: AssessmentMeta = {
  canvasId: 1,
  name: "Cell Biology Midterm",
  courseName: "BIO 211",
  courseCanvasId: 10,
  type: "exam",
  dueAt: null,
  pointsPossible: 100,
  description: null,
  aiSummary: null,
};

const materialWith = (sources: StudyMaterial["sources"]): StudyMaterial => ({
  sources,
  moduleName: null,
  sparse: false,
  excluded: [],
  aiFiltered: false,
  hash: "h",
});

describe("notesExtract.classifyNote", () => {
  it("classifies by MIME type", () => {
    expect(classifyNote("x", "application/pdf")).toBe("pdf");
    expect(classifyNote("x", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("docx");
    expect(classifyNote("x", "text/plain")).toBe("text");
  });
  it("falls back to the filename extension when MIME is unhelpful", () => {
    expect(classifyNote("notes.pdf", "application/octet-stream")).toBe("pdf");
    expect(classifyNote("notes.docx", "")).toBe("docx");
    expect(classifyNote("notes.md", "")).toBe("text");
    expect(classifyNote("notes.txt", "")).toBe("text");
  });
  it("returns null for unsupported types", () => {
    expect(classifyNote("photo.png", "image/png")).toBeNull();
    expect(classifyNote("sheet.xlsx", "application/vnd.ms-excel")).toBeNull();
  });
});

describe("notesExtract.extractNoteText (text path)", () => {
  it("extracts and normalizes plain text", async () => {
    const res = await extractNoteText(Buffer.from("  Hello\r\n\r\n\r\nworld   "), "n.txt", "text/plain");
    expect(res).toEqual({ ok: true, text: "Hello\n\nworld", sourceKind: "text" });
  });
  it("rejects unsupported types", async () => {
    expect(await extractNoteText(Buffer.from("x"), "p.png", "image/png")).toEqual({ ok: false, reason: "unsupported" });
  });
  it("reports empty when there is no usable text", async () => {
    expect(await extractNoteText(Buffer.from("   \n  "), "n.txt", "text/plain")).toEqual({ ok: false, reason: "empty" });
  });
});

describe("study generation pins student notes", () => {
  it("embeds the note text and instructs the model to treat it as authoritative", () => {
    const prompt = buildGuidePrompt(
      meta,
      materialWith([
        { kind: "description", title: "Test instructions", text: "Covers chapters 1-3." },
        { kind: "student_note", title: "My summary", text: "Mitochondria is the powerhouse of the cell." },
      ]),
    );
    expect(prompt).toContain("Mitochondria is the powerhouse of the cell.");
    expect(prompt).toContain("student_note");
    expect(prompt).toContain("student's OWN notes");
  });
});
