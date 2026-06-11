// Server-only: load the admin board, shaped to KanbanTask. Shared by the Kanban,
// Hierarchy, and Burndown pages so the select + mapping live in one place.
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { KANBAN_TASK_SELECT, toKanbanTask, type KanbanTask } from "./kanban";

export async function loadKanbanTasks(
  orderBy: Prisma.AdminTaskOrderByWithRelationInput[] = [{ status: "asc" }, { position: "asc" }],
): Promise<KanbanTask[]> {
  const rows = await prisma.adminTask.findMany({ orderBy, select: KANBAN_TASK_SELECT });
  return rows.map(toKanbanTask);
}
