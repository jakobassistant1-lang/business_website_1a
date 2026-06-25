import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { extractNoteText } from "@/lib/notesExtract";
import { MAX_FILE_BYTES, MAX_NOTES_PER_TEST, MAX_NOTE_CHARS, ownsAssessment } from "@/lib/studentNotes";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // parsing a large PDF/docx can take a few seconds

// Each extraction failure maps to a precise HTTP status so the UI can branch
// (e.g. scanned_pdf → "add it as photos instead").
const FAIL_STATUS: Record<string, number> = { unsupported: 415, empty: 422, scanned_pdf: 422, error: 422 };

// POST /api/notes/file — multipart { file, canvasId } → extract text → store.
export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const file = form.get("file");
  const canvasId = Number(form.get("canvasId"));
  if (!(file instanceof File) || !Number.isInteger(canvasId)) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "too_large", limitMb: MAX_FILE_BYTES / (1024 * 1024) }, { status: 413 });
  }
  if (!(await ownsAssessment(user.id, canvasId))) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const count = await prisma.studentNote.count({ where: { userId: user.id, canvasId } });
  if (count >= MAX_NOTES_PER_TEST) return NextResponse.json({ error: "limit_reached", limit: MAX_NOTES_PER_TEST }, { status: 409 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const extracted = await extractNoteText(buffer, file.name, file.type);
  if (!extracted.ok) return NextResponse.json({ error: extracted.reason }, { status: FAIL_STATUS[extracted.reason] ?? 422 });

  const title = (file.name.replace(/\.[^.]+$/, "") || "Uploaded notes").slice(0, 120);
  const text = extracted.text.slice(0, MAX_NOTE_CHARS);
  const note = await prisma.studentNote.create({
    data: { userId: user.id, canvasId, title, sourceKind: extracted.sourceKind, text, charCount: text.length, imageCount: 0 },
    select: { id: true, title: true, sourceKind: true, charCount: true, imageCount: true, text: true, createdAt: true },
  });
  return NextResponse.json({ ok: true, note, truncated: extracted.text.length > MAX_NOTE_CHARS });
}
