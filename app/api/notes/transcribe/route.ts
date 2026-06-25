import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { transcribeImages, type TranscribeImage } from "@/lib/notesExtract";
import { MAX_FILE_BYTES, MAX_IMAGES_PER_NOTE, ownsAssessment } from "@/lib/studentNotes";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // vision transcription can take ~10-25s

// gemini-2.5-flash accepts these image types directly (incl. iPhone HEIC/HEIF).
const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

// POST /api/notes/transcribe — multipart { images[], canvasId } → Gemini-vision
// transcription. Returns the TEXT for the student to review; does NOT persist.
// Saving happens via POST /api/notes (sourceKind: "image") after the review step.
export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const canvasId = Number(form.get("canvasId"));
  if (!Number.isInteger(canvasId)) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (!(await ownsAssessment(user.id, canvasId))) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const files = form.getAll("images").filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (files.length > MAX_IMAGES_PER_NOTE) {
    return NextResponse.json({ error: "too_many_images", limit: MAX_IMAGES_PER_NOTE }, { status: 400 });
  }

  const images: TranscribeImage[] = [];
  for (const f of files) {
    if (!IMAGE_MIME.has(f.type)) return NextResponse.json({ error: "unsupported_image" }, { status: 415 });
    if (f.size > MAX_FILE_BYTES) return NextResponse.json({ error: "too_large", limitMb: MAX_FILE_BYTES / (1024 * 1024) }, { status: 413 });
    images.push({ mimeType: f.type, base64: Buffer.from(await f.arrayBuffer()).toString("base64") });
  }

  const result = await transcribeImages(images);
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 502 });
  return NextResponse.json({ ok: true, text: result.text, imageCount: images.length });
}
