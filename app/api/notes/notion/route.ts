import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { decryptSecret } from "@/lib/crypto";
import { isNotionConfigured, searchNotionPages, fetchNotionPageText } from "@/lib/notion";
import { MAX_NOTES_PER_TEST, MAX_NOTE_CHARS, ownsAssessment } from "@/lib/studentNotes";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // walking a large Notion page can take a few seconds

// GET /api/notes/notion?q= — Notion connection status + the user's pages (search).
export async function GET(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isNotionConfigured()) return NextResponse.json({ ok: true, configured: false, connected: false });

  const conn = await prisma.notionConnection.findUnique({ where: { userId: user.id } }).catch(() => null);
  if (!conn) return NextResponse.json({ ok: true, configured: true, connected: false });

  const q = new URL(req.url).searchParams.get("q") ?? "";
  try {
    const pages = await searchNotionPages(decryptSecret(conn.accessToken), q);
    return NextResponse.json({ ok: true, configured: true, connected: true, workspace: conn.workspaceName, pages });
  } catch {
    // Token revoked in Notion / API error → surface as a soft "reconnect" state.
    return NextResponse.json({ ok: true, configured: true, connected: false, error: "notion_error" });
  }
}

// POST /api/notes/notion — import a Notion page into a test's notes.
// Body: { canvasId, pageId, title }
export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const canvasId = Number(body.canvasId);
  const pageId = typeof body.pageId === "string" ? body.pageId : "";
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 120) : "Notion page";
  if (!Number.isInteger(canvasId) || !pageId) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (!(await ownsAssessment(user.id, canvasId))) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const conn = await prisma.notionConnection.findUnique({ where: { userId: user.id } });
  if (!conn) return NextResponse.json({ error: "not_connected" }, { status: 409 });

  const count = await prisma.studentNote.count({ where: { userId: user.id, canvasId } });
  if (count >= MAX_NOTES_PER_TEST) return NextResponse.json({ error: "limit_reached", limit: MAX_NOTES_PER_TEST }, { status: 409 });

  let text = "";
  try {
    text = await fetchNotionPageText(decryptSecret(conn.accessToken), pageId);
  } catch {
    return NextResponse.json({ error: "notion_error" }, { status: 502 });
  }
  text = text.slice(0, MAX_NOTE_CHARS).trim();
  if (!text) return NextResponse.json({ error: "empty" }, { status: 422 });

  const note = await prisma.studentNote.create({
    data: { userId: user.id, canvasId, title, sourceKind: "notion", text, charCount: text.length, imageCount: 0 },
    select: { id: true, title: true, sourceKind: true, charCount: true, imageCount: true, text: true, createdAt: true },
  });
  return NextResponse.json({ ok: true, note });
}
