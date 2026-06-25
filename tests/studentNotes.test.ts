import { describe, it, expect } from "vitest";
import { classifyNote, extractNoteText, buildTranscribeBody } from "@/lib/notesExtract";
import { buildGuidePrompt, type AssessmentMeta, type StudyMaterial } from "@/lib/study";
import { blockToLine, pageTitle } from "@/lib/notion";

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

describe("notesExtract.buildTranscribeBody (handwriting → Gemini vision)", () => {
  it("builds a multimodal request: prompt text + inlineData image parts", () => {
    const body = buildTranscribeBody([
      { mimeType: "image/png", base64: "AAAA" },
      { mimeType: "image/jpeg", base64: "BBBB" },
    ]);
    const parts = body.contents[0].parts;
    expect(parts[0]).toHaveProperty("text");
    expect(parts[1]).toEqual({ inlineData: { mimeType: "image/png", data: "AAAA" } });
    expect(parts[2]).toEqual({ inlineData: { mimeType: "image/jpeg", data: "BBBB" } });
    expect(body.generationConfig.thinkingConfig.thinkingBudget).toBe(0);
  });
});

describe("notion.blockToLine / pageTitle", () => {
  const rt = (s: string) => [{ plain_text: s }];
  it("maps common Notion blocks to markdown-ish lines", () => {
    expect(blockToLine({ type: "heading_1", heading_1: { rich_text: rt("Topic") } })).toBe("# Topic");
    expect(blockToLine({ type: "bulleted_list_item", bulleted_list_item: { rich_text: rt("a") } })).toBe("- a");
    expect(blockToLine({ type: "to_do", to_do: { rich_text: rt("task"), checked: true } })).toBe("- [x] task");
    expect(blockToLine({ type: "divider", divider: {} })).toBe("---");
  });
  it("drops empty paragraphs (Notion uses them for spacing)", () => {
    expect(blockToLine({ type: "paragraph", paragraph: { rich_text: [] } })).toBeNull();
  });
  it("reads a page title from the title-typed property, else 'Untitled'", () => {
    expect(pageTitle({ properties: { Name: { type: "title", title: rt("My Page") } } })).toBe("My Page");
    expect(pageTitle({ properties: { Tags: { type: "multi_select" } } })).toBe("Untitled");
  });
});
