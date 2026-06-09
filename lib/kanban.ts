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

// Ticket-size tag — constrained to a fixed set (the only validated tag).
export const TICKET_SIZES = ["small", "medium", "large"] as const;
export type TicketSize = (typeof TICKET_SIZES)[number];
export const TICKET_SIZE_LABEL: Record<TicketSize, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
};
export function isTicketSize(s: unknown): s is TicketSize {
  return typeof s === "string" && (TICKET_SIZES as readonly string[]).includes(s);
}

export interface KanbanTask {
  id: number;
  title: string;
  description: string | null;
  status: KanbanStatus;
  position: number;
  dueDate: string | null; // ISO 8601 (client renders the date part)
  category: string | null; // free-form category tag
  ticketSize: TicketSize | null;
  contributor: string | null; // free-text (name or initials)
  creatorName: string | null; // from createdBy.fullName; rendered as initials
}

export const MAX_TASK_TITLE = 200;
export const MAX_TASK_DESCRIPTION = 2000;
export const MAX_CATEGORY = 40;
export const MAX_CONTRIBUTOR = 60;

// Normalized, ready-to-persist values for the optional card fields.
export type TaskFieldUpdates = {
  description?: string | null;
  dueDate?: Date | null;
  category?: string | null;
  ticketSize?: TicketSize | null;
  contributor?: string | null;
};

/**
 * Validate + normalize the optional card fields from a request body. Only keys
 * actually present in the body are returned, so the result can be spread into
 * both a Prisma `create` (absent → DB default null) and an `update` (absent →
 * left unchanged). Empty/invalid values normalize to `null` (clears the field).
 */
export function parseTaskFields(body: unknown): TaskFieldUpdates {
  const b: Record<string, unknown> =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const out: TaskFieldUpdates = {};
  const trimTo = (v: unknown, max: number): string | null => {
    const s = typeof v === "string" ? v.trim() : "";
    return s ? s.slice(0, max) : null;
  };

  if ("description" in b) out.description = trimTo(b.description, MAX_TASK_DESCRIPTION);
  if ("category" in b) out.category = trimTo(b.category, MAX_CATEGORY);
  if ("contributor" in b) out.contributor = trimTo(b.contributor, MAX_CONTRIBUTOR);
  if ("ticketSize" in b) out.ticketSize = isTicketSize(b.ticketSize) ? b.ticketSize : null;
  if ("dueDate" in b) {
    const v = b.dueDate;
    if (v === null || v === "" || v === undefined) {
      out.dueDate = null;
    } else {
      const d = typeof v === "string" || typeof v === "number" ? new Date(v) : null;
      out.dueDate = d && !Number.isNaN(d.getTime()) ? d : null;
    }
  }
  return out;
}

// Single source of truth for the columns the client/server exchange.
export const KANBAN_TASK_SELECT = {
  id: true,
  title: true,
  description: true,
  status: true,
  position: true,
  dueDate: true,
  category: true,
  ticketSize: true,
  contributor: true,
  createdBy: { select: { fullName: true } },
} as const;

/**
 * Coerce a raw DB row to a typed KanbanTask. Prisma types `status`/`ticketSize`
 * as plain strings; out-of-range values (e.g. a manually/legacy-inserted row)
 * are coerced to a safe value ("todo" / null) so the card stays visible and
 * movable instead of breaking — never trusted blindly. `dueDate` accepts a Date
 * (Prisma) or string (JSON/tests) and is normalized to ISO.
 */
export function toKanbanTask(row: {
  id: number;
  title: string;
  description?: string | null;
  status: string;
  position: number;
  dueDate?: Date | string | null;
  category?: string | null;
  ticketSize?: string | null;
  contributor?: string | null;
  createdBy?: { fullName: string } | null;
}): KanbanTask {
  const due = row.dueDate
    ? row.dueDate instanceof Date
      ? row.dueDate
      : new Date(row.dueDate)
    : null;
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    status: isKanbanStatus(row.status) ? row.status : "todo",
    position: row.position,
    dueDate: due && !Number.isNaN(due.getTime()) ? due.toISOString() : null,
    category: row.category ?? null,
    ticketSize: isTicketSize(row.ticketSize) ? row.ticketSize : null,
    contributor: row.contributor ?? null,
    creatorName: row.createdBy?.fullName ?? null,
  };
}
