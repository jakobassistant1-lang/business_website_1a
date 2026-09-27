// The 2026-09-26 prod bug: pdfjs (wrapped by pdf-parse) does `new DOMMatrix()`
// at MODULE SCOPE and only shims it from the optional native @napi-rs/canvas,
// which doesn't load inside Vercel's bundle → `ReferenceError: DOMMatrix is not
// defined` at import time → HTTP 500 for every guide/questions request.
// Guarantees pinned here:
//   (a) a throwing `import("pdf-parse")` is a SKIPPED FILE — the rest of the
//       material still flows out of collectStudyMaterial (fail-open at the
//       import boundary);
//   (b) installPdfPolyfills is idempotent, defines the globals when missing and
//       never overwrites a real one;
//   (c) with @napi-rs/canvas BLOCKED and only our shims installed, a real
//       one-page PDF parses to text on plain Node — the server path works.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import Module from "node:module";
import { installPdfPolyfills, isPdfPolyfillStub, PDF_POLYFILL_NAMES } from "@/lib/pdfPolyfills";
import type { AssessmentMeta } from "@/lib/study";

// Never touch Canvas or Gemini: canvas helpers are stubbed per test, and no key
// makes the relevance check fail open (keep everything) without a network call.
vi.mock("@/lib/canvas", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/canvas")>();
  return {
    ...real,
    fetchModules: vi.fn(),
    fetchPageBody: vi.fn(),
    fetchSyllabus: vi.fn(),
    fetchFileMeta: vi.fn(),
    downloadCanvasFile: vi.fn(),
  };
});
vi.mock("@/lib/geminiFetch", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/geminiFetch")>();
  return { ...real, geminiKey: () => undefined, geminiPost: vi.fn() };
});

const g = globalThis as unknown as Record<string, unknown>;
const dropGlobals = () => {
  for (const n of PDF_POLYFILL_NAMES) delete g[n];
};

/** A minimal but valid one-page PDF (Helvetica text object, correct xref).
 *  Lines are split on " | " so nothing runs off the MediaBox (pdfjs drops
 *  off-page glyphs from the text layer). */
function minimalPdf(text: string): Buffer {
  const lines = text.split(" | ").map((l) => `(${l}) Tj 0 -16 Td`);
  const stream = `BT /F1 12 Tf 72 700 Td ${lines.join(" ")} ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1"); // ASCII only, so string offsets == byte offsets
}

const PDF_TEXT =
  "Hello Navo study guide: mitochondria are the powerhouse of the cell. | " +
  "ATP synthesis happens in the electron transport chain after the Krebs cycle. | " +
  "Glycolysis splits glucose into two pyruvate molecules in the cytosol.";

const assessment: AssessmentMeta = {
  canvasId: 501,
  name: "Unit 3 Exam",
  courseName: "Biology 101",
  courseCanvasId: 77,
  type: "exam",
  dueAt: new Date("2026-10-10T00:00:00Z"),
  pointsPossible: 100,
  description: "<p>Covers chapters 7-9.</p>",
  aiSummary: null,
};

async function primeCanvasMocks() {
  const canvas = await import("@/lib/canvas");
  vi.clearAllMocks(); // call counts are per test, not per file
  vi.mocked(canvas.fetchModules).mockResolvedValue([
    {
      id: 1,
      name: "Unit 3",
      position: 3,
      items: [
        { id: 10, title: "Unit 3 Exam", type: "Assignment", content_id: 501 },
        { id: 11, title: "Cell respiration notes", type: "Page", page_url: "cell-respiration-notes" },
        { id: 12, title: "Lecture 7 slides.pdf", type: "File", content_id: 9001 },
        { id: 13, title: "Krebs cycle video", type: "ExternalUrl", external_url: "https://example.invalid/v" },
      ],
    },
  ]);
  vi.mocked(canvas.fetchPageBody).mockResolvedValue({
    title: "Cell respiration notes",
    body: "<p>Glycolysis happens in the cytosol; the Krebs cycle runs in the mitochondrial matrix and feeds the electron transport chain with NADH and FADH2 for oxidative phosphorylation.</p>",
  } as Awaited<ReturnType<typeof canvas.fetchPageBody>>);
  vi.mocked(canvas.fetchSyllabus).mockResolvedValue("<p>Exam 3 covers cellular respiration and photosynthesis, chapters 7 through 9 of the textbook.</p>");
  vi.mocked(canvas.fetchFileMeta).mockResolvedValue({
    id: 9001,
    display_name: "Lecture 7 slides.pdf",
    "content-type": "application/pdf",
    size: 1234,
    url: "https://canvas.invalid/files/9001/download?verifier=x",
  });
  vi.mocked(canvas.downloadCanvasFile).mockResolvedValue(minimalPdf(PDF_TEXT));
  return canvas;
}

describe("installPdfPolyfills (b)", () => {
  beforeEach(dropGlobals);

  it("defines DOMMatrix/Path2D/ImageData when missing and is a no-op the second time", () => {
    expect(typeof g.DOMMatrix).toBe("undefined");
    expect(installPdfPolyfills()).toEqual(["DOMMatrix", "Path2D", "ImageData"]);
    const first = g.DOMMatrix;
    expect(installPdfPolyfills()).toEqual([]);
    expect(g.DOMMatrix).toBe(first);
    expect(isPdfPolyfillStub("DOMMatrix")).toBe(true);
  });

  it("the DOMMatrix stub is constructible (no-arg = what pdfjs does at module scope) and chainable", () => {
    installPdfPolyfills();
    const Ctor = g.DOMMatrix as new (init?: unknown) => Record<string, unknown> & { translate(): unknown; scale(): unknown };
    const m = new Ctor();
    expect([m.a, m.b, m.c, m.d, m.e, m.f]).toEqual([1, 0, 0, 1, 0, 0]);
    expect([m.m11, m.m22, m.m33, m.m44]).toEqual([1, 1, 1, 1]);
    expect(m.isIdentity).toBe(true);
    expect(m.translate()).toBe(m);
    expect(m.scale()).toBe(m);
    const t = new Ctor([2, 0, 0, 2, 5, 6]);
    expect([t.a, t.d, t.e, t.f, t.isIdentity]).toEqual([2, 2, 5, 6, false]);
  });

  it("never overwrites a real global", () => {
    const real = class RealDOMMatrix {};
    g.DOMMatrix = real;
    expect(installPdfPolyfills()).toEqual(["Path2D", "ImageData"]);
    expect(g.DOMMatrix).toBe(real);
    expect(isPdfPolyfillStub("DOMMatrix")).toBe(false);
  });
});

describe("real PDF on plain Node with only the shims (c)", () => {
  // Block the optional native package the way Vercel's bundle effectively does:
  // pdfjs requires it through createRequire → Module._load, which we intercept.
  const mod = Module as unknown as { _load: (req: string, ...rest: unknown[]) => unknown };
  const origLoad = mod._load;
  let canvasLoadAttempts = 0;
  mod._load = function (this: unknown, req: string, ...rest: unknown[]) {
    if (req === "@napi-rs/canvas") {
      canvasLoadAttempts++;
      throw new Error("blocked by studyPdf.test");
    }
    return origLoad.call(this, req, ...rest);
  };
  afterAll(() => {
    mod._load = origLoad;
  });

  it("parses a one-page PDF to its text layer via pdf-parse", async () => {
    dropGlobals();
    installPdfPolyfills();
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: minimalPdf(PDF_TEXT) });
    const res = await parser.getText();
    await parser.destroy();
    expect(res.text.replace(/\s+/g, " ")).toContain("mitochondria are the powerhouse of the cell");
    // The native package was asked for and refused — our stub carried module init.
    expect(canvasLoadAttempts).toBeGreaterThan(0);
    expect(isPdfPolyfillStub("DOMMatrix")).toBe(true);
  });

  it("collectStudyMaterial wires that text into a `file` source (happy path through the collector)", async () => {
    const canvas = await primeCanvasMocks();
    const { collectStudyMaterial } = await import("@/lib/study");
    const material = await collectStudyMaterial("school.instructure.com", "tok", assessment, []);
    const file = material.sources.find((s) => s.kind === "file");
    expect(file?.title).toBe("Lecture 7 slides.pdf");
    expect(file?.text).toContain("Krebs cycle");
    expect(vi.mocked(canvas.downloadCanvasFile)).toHaveBeenCalledTimes(1);
  });
});

describe("fail-open at the pdf-parse import boundary (a)", () => {
  it("a throwing import('pdf-parse') skips the file and keeps every other source", async () => {
    dropGlobals();
    expect(typeof g.DOMMatrix).toBe("undefined");
    vi.resetModules();
    vi.doMock("pdf-parse", () => {
      throw new ReferenceError("DOMMatrix is not defined"); // exact prod failure, at module init
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const canvas = await primeCanvasMocks();
      const { collectStudyMaterial } = await import("@/lib/study");
      const material = await collectStudyMaterial("school.instructure.com", "tok", assessment, [
        { title: "Exam 3 reminder", message: "<p>Unit 3 Exam is Friday — bring a pencil.</p>", postedAt: new Date("2026-10-05T00:00:00Z") },
      ]);
      const kinds = material.sources.map((s) => s.kind);
      expect(kinds).toContain("description");
      expect(kinds).toContain("page");
      expect(kinds).toContain("module_item");
      expect(kinds).toContain("announcement");
      expect(kinds).toContain("syllabus");
      expect(kinds).not.toContain("file");
      expect(material.moduleName).toBe("Unit 3");
      // The PDF step really ran (download happened) and failed open with ONE warning.
      expect(vi.mocked(canvas.downloadCanvasFile)).toHaveBeenCalledTimes(1);
      const msgs = warn.mock.calls.map((c) => String(c[0]));
      // (vitest wraps a throwing factory in its own message, so the original
      // ReferenceError text isn't asserted — the file title and count are ours.)
      const skipped = msgs.filter((m) => m.startsWith("[study] pdf text skipped:"));
      expect(skipped).toHaveLength(1);
      expect(skipped[0]).toContain("Lecture 7 slides.pdf");
    } finally {
      warn.mockRestore();
      vi.doUnmock("pdf-parse");
    }
  });

  it("a parser that throws inside getText is also just a skipped file", async () => {
    vi.resetModules();
    vi.doMock("pdf-parse", () => ({
      PDFParse: class {
        async getText(): Promise<never> {
          throw new Error("worker exploded");
        }
        async destroy(): Promise<void> {}
      },
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await primeCanvasMocks();
      const { collectStudyMaterial } = await import("@/lib/study");
      const material = await collectStudyMaterial("school.instructure.com", "tok", assessment, []);
      expect(material.sources.map((s) => s.kind)).not.toContain("file");
      expect(material.sources.map((s) => s.kind)).toContain("page");
      expect(warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("worker exploded"))).toHaveLength(1);
    } finally {
      warn.mockRestore();
      vi.doUnmock("pdf-parse");
    }
  });
});
