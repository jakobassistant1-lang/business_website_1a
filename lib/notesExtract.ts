// Server-only text extraction for student-uploaded notes. Mirrors the Canvas PDF
// path in lib/study.ts: pdf-parse for PDFs (dynamic import + scanned detection),
// mammoth for .docx, raw UTF-8 for text/markdown. Only the EXTRACTED TEXT is ever
// returned — the original bytes are never persisted (text-only by design). Fails
// closed with a typed reason so the API/UI can show a precise message (and route
// scanned PDFs to the photo path).

export type ExtractKind = "pdf" | "docx" | "text";
export type ExtractFail =
  | "unsupported" // not a type we can read
  | "empty" // parsed, but no usable text
  | "scanned_pdf" // a PDF with no real text layer (image-only) → suggest photos
  | "error"; // the parser threw

export type ExtractResult = { ok: true; text: string; sourceKind: ExtractKind } | { ok: false; reason: ExtractFail };

const PDF_MIN_TEXT = 80; // mirror lib/study.ts: under this ⇒ a scanned/image-only PDF

function normalize(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Pick the extractor from MIME type, falling back to the filename extension —
 *  browsers don't reliably set a content-type for .md / .docx. */
export function classifyNote(filename: string, mime: string): ExtractKind | null {
  const name = filename.toLowerCase();
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || name.endsWith(".docx")) return "docx";
  if (mime.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".markdown")) return "text";
  return null;
}

export async function extractNoteText(buffer: Buffer, filename: string, mime: string): Promise<ExtractResult> {
  const kind = classifyNote(filename, mime);
  if (!kind) return { ok: false, reason: "unsupported" };

  try {
    if (kind === "pdf") {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: buffer });
      try {
        const res = await parser.getText();
        const text = normalize(res?.text ?? "");
        if (text.length < PDF_MIN_TEXT) return { ok: false, reason: "scanned_pdf" };
        return { ok: true, text, sourceKind: "pdf" };
      } finally {
        await (parser as { destroy?: () => Promise<void> }).destroy?.();
      }
    }

    if (kind === "docx") {
      const mod = await import("mammoth");
      const extractRawText = mod.extractRawText ?? (mod as unknown as { default?: typeof mod }).default?.extractRawText;
      if (!extractRawText) return { ok: false, reason: "error" };
      const res = await extractRawText({ buffer });
      const text = normalize(res?.value ?? "");
      return text ? { ok: true, text, sourceKind: "docx" } : { ok: false, reason: "empty" };
    }

    // text / markdown
    const text = normalize(buffer.toString("utf8"));
    return text ? { ok: true, text, sourceKind: "text" } : { ok: false, reason: "empty" };
  } catch {
    return { ok: false, reason: "error" };
  }
}
