// Server-only: load a board's cards, shaped to KanbanTask. Shared by the Kanban,
// Hierarchy, and Burndown pages so the select + mapping live in one place.
// `board` defaults to "build", so the existing build-board pages are unchanged.
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { KANBAN_TASK_SELECT, toKanbanTask, type KanbanTask, type Board, DEFAULT_BOARD } from "./kanban";

export async function loadKanbanTasks(
  orderBy: Prisma.AdminTaskOrderByWithRelationInput[] = [{ status: "asc" }, { position: "asc" }],
  board: Board = DEFAULT_BOARD,
): Promise<KanbanTask[]> {
  const rows = await prisma.adminTask.findMany({ where: { board }, orderBy, select: KANBAN_TASK_SELECT });
  return rows.map(toKanbanTask);
}
