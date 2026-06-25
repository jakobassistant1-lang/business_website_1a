import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { MAX_NOTE_CHARS } from "@/lib/studentNotes";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const parseId = (v: string): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// PATCH /api/notes/[id] — rename (title) and/or edit text. Ownership-checked.
export async function PATCH(req: Request, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const existing = await prisma.studentNote.findFirst({ where: { id, userId: user.id }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const data: { title?: string; text?: string; charCount?: number } = {};
  if (typeof body.title === "string" && body.title.trim()) data.title = body.title.trim().slice(0, 120);
  if (typeof body.text === "string") {
    const text = body.text.trim().slice(0, MAX_NOTE_CHARS);
    if (!text) return NextResponse.json({ error: "bad_request" }, { status: 400 });
    data.text = text;
    data.charCount = text.length;
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const note = await prisma.studentNote.update({
    where: { id },
    data,
    select: { id: true, title: true, sourceKind: true, charCount: true, imageCount: true, text: true, createdAt: true },
  });
  return NextResponse.json({ ok: true, note });
}

// DELETE /api/notes/[id] — ownership-scoped via deleteMany (only the caller's row).
export async function DELETE(_req: Request, ctx: Ctx) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const result = await prisma.studentNote.deleteMany({ where: { id, userId: user.id } });
  if (result.count === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
