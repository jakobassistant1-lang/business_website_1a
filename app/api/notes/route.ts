import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { MAX_NOTES_PER_TEST, MAX_NOTE_CHARS, ownsAssessment } from "@/lib/studentNotes";

export const dynamic = "force-dynamic";

// GET /api/notes?canvasId= — the student's notes for one test. Includes `text` so
// the UI's "View extracted text" disclosure needs no extra round-trip.
export async function GET(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const canvasId = Number(new URL(req.url).searchParams.get("canvasId"));
  if (!Number.isInteger(canvasId)) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const notes = await prisma.studentNote.findMany({
    where: { userId: user.id, canvasId },
    select: { id: true, title: true, sourceKind: true, charCount: true, imageCount: true, text: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ ok: true, notes, limit: MAX_NOTES_PER_TEST });
}

// POST /api/notes — create a note from pasted (or reviewed-transcription) TEXT.
// Body: { canvasId, title?, text, sourceKind?, imageCount? }
export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const canvasId = Number(body.canvasId);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 120) : "Pasted notes";
  const sourceKind = body.sourceKind === "image" ? "image" : "paste";
  const imageCount = sourceKind === "image" && Number.isInteger(body.imageCount) ? Math.max(0, Math.min(20, body.imageCount)) : 0;

  if (!Number.isInteger(canvasId) || !text) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (!(await ownsAssessment(user.id, canvasId))) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const count = await prisma.studentNote.count({ where: { userId: user.id, canvasId } });
  if (count >= MAX_NOTES_PER_TEST) return NextResponse.json({ error: "limit_reached", limit: MAX_NOTES_PER_TEST }, { status: 409 });

  const clipped = text.slice(0, MAX_NOTE_CHARS);
  const note = await prisma.studentNote.create({
    data: { userId: user.id, canvasId, title, sourceKind, text: clipped, charCount: clipped.length, imageCount },
    select: { id: true, title: true, sourceKind: true, charCount: true, imageCount: true, text: true, createdAt: true },
  });
  return NextResponse.json({ ok: true, note, truncated: text.length > MAX_NOTE_CHARS });
}
