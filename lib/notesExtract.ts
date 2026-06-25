// Server-only text extraction for student-uploaded notes. Mirrors the Canvas PDF
// path in lib/study.ts: pdf-parse for PDFs (dynamic import + scanned detection),
// mammoth for .docx, raw UTF-8 for text/markdown. Only the EXTRACTED TEXT is ever
// returned — the original bytes are never persisted (text-only by design). Fails
// closed with a typed reason so the API/UI can show a precise message (and route
// scanned PDFs to the photo path).

import { GEMINI_URL, geminiKey, geminiPost } from "@/lib/geminiFetch";

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

// ---------- handwriting photos → text (Gemini vision) ----------
// Reuses the SAME model the study engine uses (gemini-2.5-flash is multimodal),
// so there's no new dependency or API key. The transcription is returned for the
// student to review/edit before saving (OCR can err); saving then goes through
// POST /api/notes like any other text note.

const TRANSCRIBE_PROMPT =
  "You are transcribing a student's handwritten study notes from one or more photos. Output ONLY the transcription " +
  "as clean plain text / markdown: preserve structure (headings, bullet/numbered lists), render math as LaTeX " +
  "(e.g. $x^2$), and briefly describe any diagrams in [square brackets]. Do not add commentary, summaries, or " +
  "anything not present in the images.";

export type TranscribeImage = { mimeType: string; base64: string };
export type TranscribeResult = { ok: true; text: string } | { ok: false; reason: "no_key" | "timeout" | "http_error" | "empty" };

/** The multimodal Gemini request body (exported so the part shape can be tested). */
export function buildTranscribeBody(images: TranscribeImage[]) {
  return {
    contents: [
      {
        role: "user",
        parts: [{ text: TRANSCRIBE_PROMPT }, ...images.map((im) => ({ inlineData: { mimeType: im.mimeType, data: im.base64 } }))],
      },
    ],
    generationConfig: { temperature: 0.1, maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 0 } },
  };
}

/** Pull the text candidate out of a Gemini generateContent response. */
function responseText(json: unknown): string {
  const parts = (json as { candidates?: { content?: { parts?: { text?: string }[] } }[] })?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .join("")
    .trim();
}

export async function transcribeImages(images: TranscribeImage[]): Promise<TranscribeResult> {
  const key = geminiKey();
  if (!key) return { ok: false, reason: "no_key" };
  const { res, timedOut } = await geminiPost(`${GEMINI_URL}?key=${encodeURIComponent(key)}`, buildTranscribeBody(images), {
    timeoutMs: 30000,
  });
  if (timedOut) return { ok: false, reason: "timeout" };
  if (!res || !res.ok) return { ok: false, reason: "http_error" };
  const json = await res.json().catch(() => null);
  const text = responseText(json);
  return text ? { ok: true, text } : { ok: false, reason: "empty" };
}
