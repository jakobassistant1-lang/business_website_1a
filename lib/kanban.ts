// Shared Kanban config + types for the admin team board. Imported by both the
// API route handlers (validation) and the client board (rendering).

export const KANBAN_COLUMNS = [
  { id: "todo", title: "To Do" },
  { id: "progress", title: "In Progress" },
  { id: "review", title: "Review" },
  { id: "done", title: "Done" },
] as const;

export type KanbanStatus = (typeof KANBAN_COLUMNS)[number]["id"];

export const KANBAN_STATUSES = KANBAN_COLUMNS.map((c) => c.id) as KanbanStatus[];

export function isKanbanStatus(s: unknown): s is KanbanStatus {
  return typeof s === "string" && (KANBAN_STATUSES as string[]).includes(s);
}

export interface KanbanTask {
  id: number;
  title: string;
  status: KanbanStatus;
  position: number;
}

export const MAX_TASK_TITLE = 200;

// Single source of truth for the columns the client/server exchange.
export const KANBAN_TASK_SELECT = {
  id: true,
  title: true,
  status: true,
  position: true,
} as const;

/**
 * Coerce a raw DB row to a typed KanbanTask. Prisma types `status` as a plain
 * string; an out-of-range value (e.g. a manually/legacy-inserted row) is mapped
 * to "todo" so the card stays visible and movable instead of rendering in no
 * column — never trusted blindly as a KanbanStatus.
 */
export function toKanbanTask(row: {
  id: number;
  title: string;
  status: string;
  position: number;
}): KanbanTask {
  return {
    id: row.id,
    title: row.title,
    status: isKanbanStatus(row.status) ? row.status : "todo",
    position: row.position,
  };
}
