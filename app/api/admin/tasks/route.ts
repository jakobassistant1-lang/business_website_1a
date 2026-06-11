import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withAdmin } from "@/lib/admin";
import {
  isKanbanStatus,
  MAX_TASK_TITLE,
  KANBAN_TASK_SELECT,
  toKanbanTask,
  parseTaskFields,
  completedAtPatch,
} from "@/lib/kanban";

// GET /api/admin/tasks — list every task on the team board, column-ordered.
export const GET = withAdmin(async () => {
  const rows = await prisma.adminTask.findMany({
    orderBy: [{ status: "asc" }, { position: "asc" }],
    select: KANBAN_TASK_SELECT,
  });
  return NextResponse.json({ tasks: rows.map(toKanbanTask) });
});

// POST /api/admin/tasks — create a task, appended to the end of its column.
export const POST = withAdmin(async (admin, req) => {
  const body = await req.json().catch(() => ({}));
  const title = String(body.title ?? "").trim().slice(0, MAX_TASK_TITLE);
  const status = isKanbanStatus(body.status) ? body.status : "todo";
  if (!title) return NextResponse.json({ error: "Title is required." }, { status: 400 });
  const fields = parseTaskFields(body);

  // Append to the end. Use max(position)+1 rather than count(): cross-column
  // moves can leave positional gaps, and count() could collide with an existing
  // card's position. max+1 is always free.
  const last = await prisma.adminTask.findFirst({
    where: { status },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const position = last ? last.position + 1 : 0;
  const completed = completedAtPatch(status);

  // Continue the global build numbering so new cards stay numbered (the burndown
  // total grows with them). ticketNumber is @unique, so two concurrent creates
  // that both read the same max+1 will collide — retry on the unique violation.
  for (let attempt = 0; attempt < 5; attempt++) {
    const maxNum = await prisma.adminTask.aggregate({ _max: { ticketNumber: true } });
    const ticketNumber = (maxNum._max.ticketNumber ?? 0) + 1;
    try {
      const task = await prisma.adminTask.create({
        data: { title, status, position, createdById: admin.id, ticketNumber, ...completed, ...fields },
        select: KANBAN_TASK_SELECT,
      });
      return NextResponse.json({ task: toKanbanTask(task) }, { status: 201 });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue; // number race → retry
      throw e;
    }
  }
  return NextResponse.json({ error: "Couldn't assign a ticket number — try again." }, { status: 409 });
});
