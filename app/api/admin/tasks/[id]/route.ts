import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAdmin } from "@/lib/admin";
import {
  isKanbanStatus,
  MAX_TASK_TITLE,
  KANBAN_TASK_SELECT,
  toKanbanTask,
  parseTaskFields,
} from "@/lib/kanban";

type Ctx = { params: Promise<{ id: string }> };

// Only canonical positive-integer ids — rejects "0x10", "1e2", "12.0", " 5 ", "-1".
function parseId(v: string): number | null {
  if (!/^[0-9]+$/.test(v)) return null;
  const n = Number(v);
  return n > 0 ? n : null;
}

// PATCH /api/admin/tasks/:id — edit title and/or move/reorder.
//   { title }            → rename in place
//   { status }           → move to the end of another column
//   { status, position } → move/reorder to an explicit 0-based slot (drag-drop)
export const PATCH = withAdmin(async (_admin, req, ctx: Ctx) => {
  const id = parseId((await ctx.params).id);
  if (id === null) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const newTitle = typeof body.title === "string" ? body.title.trim().slice(0, MAX_TASK_TITLE) : undefined;
  if (newTitle !== undefined && newTitle.length === 0) {
    return NextResponse.json({ error: "Title cannot be empty." }, { status: 400 });
  }
  const wantStatus = isKanbanStatus(body.status) ? body.status : undefined;
  const wantPosition = Number.isInteger(body.position) ? (body.position as number) : undefined;
  // Optional card fields (description / dueDate / category / ticketSize /
  // contributor). Only keys present in the body are returned, so unsent fields
  // stay unchanged on edit.
  const fields = parseTaskFields(body);

  // Read the target column AND write the re-sequence inside one interactive
  // transaction. This serializes concurrent moves (the second move sees the
  // positions the first already committed) — no read-then-write lost update.
  const updated = await prisma.$transaction(async (tx) => {
    const task = await tx.adminTask.findUnique({ where: { id } });
    if (!task) return null;

    const newStatus = wantStatus ?? task.status;
    const others = await tx.adminTask.findMany({
      where: { status: newStatus, id: { not: id } },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    const ids = others.map((t) => t.id);
    const clamp = (n: number) => Math.max(0, Math.min(n, ids.length));
    const insertAt =
      wantPosition !== undefined
        ? clamp(wantPosition)
        : newStatus !== task.status
        ? ids.length // moving columns with no explicit slot → append
        : clamp(task.position); // staying put
    ids.splice(insertAt, 0, id);

    for (let i = 0; i < ids.length; i++) {
      await tx.adminTask.update({
        where: { id: ids[i] },
        data: {
          position: i,
          status: newStatus, // no-op for the others (already in this column)
          // Title + the optional fields apply only to the moved/edited card.
          ...(ids[i] === id && newTitle !== undefined ? { title: newTitle } : {}),
          ...(ids[i] === id ? fields : {}),
        },
      });
    }
    return tx.adminTask.findUnique({ where: { id }, select: KANBAN_TASK_SELECT });
  });

  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ task: toKanbanTask(updated) });
});

// DELETE /api/admin/tasks/:id — idempotent remove.
export const DELETE = withAdmin(async (_admin, req, ctx: Ctx) => {
  const id = parseId((await ctx.params).id);
  if (id === null) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await prisma.adminTask.deleteMany({ where: { id } });
  return NextResponse.json({ ok: true });
});
