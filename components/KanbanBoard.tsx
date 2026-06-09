"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KANBAN_COLUMNS,
  KANBAN_STATUSES,
  TICKET_SIZES,
  TICKET_SIZE_LABEL,
  type KanbanStatus,
  type KanbanTask,
  type TicketSize,
} from "@/lib/kanban";
import { toneBar, toneSoft, type Tone } from "@/lib/tone";

type ToastKind = "success" | "info" | "warning" | "danger";
interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
}

// Draft values held by the create/edit modal. Tag/date fields are plain strings
// here ("" = unset) and normalized to null on save.
interface TaskDraft {
  title: string;
  status: KanbanStatus;
  description: string;
  contributor: string;
  dueDate: string; // YYYY-MM-DD or ""
  category: string;
  ticketSize: TicketSize | "";
}

// Per-column accent dot.
const DOT: Record<KanbanStatus, string> = {
  todo: "bg-faint",
  progress: "bg-accent",
  review: "bg-warning",
  done: "bg-success",
};

// Ticket-size dot color. The chip itself stays neutral (AA-safe) and the dot
// carries the size cue, reusing the shared semantic tones.
const TICKET_TONE: Record<TicketSize, Tone> = {
  small: "success",
  medium: "warning",
  large: "danger",
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

// Due dates are stored as UTC-midnight ISO strings; render/compare in UTC so the
// day shown matches the day picked, regardless of the viewer's timezone.
function formatDue(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}
function isOverdue(iso: string): boolean {
  const today = new Date();
  const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return new Date(iso).getTime() < todayUTC;
}

// Normalize draft tag/date fields into the shape stored on a KanbanTask (for
// optimistic UI). "" / unset → null.
function draftToFields(
  d: TaskDraft,
): Pick<KanbanTask, "description" | "dueDate" | "category" | "ticketSize" | "contributor"> {
  const clean = (s: string) => s.trim() || null;
  return {
    description: clean(d.description),
    category: clean(d.category),
    contributor: clean(d.contributor),
    ticketSize: d.ticketSize || null,
    dueDate: d.dueDate ? new Date(d.dueDate).toISOString() : null,
  };
}

/** Re-sequences the target column with `id` inserted at `index`. Mirrors the
 *  server's PATCH logic so optimistic state matches what gets persisted. */
function reorder(tasks: KanbanTask[], id: number, status: KanbanStatus, index: number): KanbanTask[] {
  const moved = tasks.find((t) => t.id === id);
  if (!moved) return tasks;
  const target = tasks
    .filter((t) => t.status === status && t.id !== id)
    .sort((a, b) => a.position - b.position);
  const at = Math.max(0, Math.min(index, target.length));
  target.splice(at, 0, { ...moved, status });
  const resequenced = target.map((t, i) => ({ ...t, status, position: i }));
  const rest = tasks.filter((t) => t.status !== status && t.id !== id);
  return [...rest, ...resequenced];
}

export function KanbanBoard({ initial, adminName }: { initial: KanbanTask[]; adminName: string }) {
  const [tasks, setTasks] = useState<KanbanTask[]>(initial);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dragId, setDragId] = useState<number | null>(null);
  const [dragOverCol, setDragOverCol] = useState<KanbanStatus | null>(null);

  // Modal state.
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftStatus, setDraftStatus] = useState<KanbanStatus>("todo");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftContributor, setDraftContributor] = useState("");
  const [draftDueDate, setDraftDueDate] = useState("");
  const [draftCategory, setDraftCategory] = useState("");
  const [draftTicketSize, setDraftTicketSize] = useState<TicketSize | "">("");
  const [titleError, setTitleError] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const toastSeq = useRef(0);
  const toastTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const pushToast = useCallback((kind: ToastKind, title: string) => {
    const id = ++toastSeq.current;
    setToasts((prev) => [...prev, { id, kind, title }]);
    const handle = setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2800);
    toastTimers.current.push(handle);
  }, []);

  // Clear any pending toast timers on unmount so they don't setState afterward.
  useEffect(() => {
    const timers = toastTimers.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/tasks");
      if (res.ok) {
        const body = await res.json();
        setTasks(body.tasks ?? []);
      }
    } catch {
      /* ignore — keep showing what we have */
    }
  }, []);

  // Bucket + sort once per tasks change, rather than filtering+sorting the full
  // array 4× on every render (including drag-hover re-renders).
  const grouped = useMemo(() => {
    const g: Record<KanbanStatus, KanbanTask[]> = { todo: [], progress: [], review: [], done: [] };
    for (const t of tasks) g[t.status].push(t);
    for (const s of KANBAN_STATUSES) g[s].sort((a, b) => a.position - b.position);
    return g;
  }, [tasks]);
  const byColumn = (status: KanbanStatus) => grouped[status];

  // ---------- Mutations (optimistic; refetch on failure) ----------

  async function createTask(draft: TaskDraft) {
    try {
      const res = await fetch("/api/admin/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) throw new Error();
      const { task } = await res.json();
      setTasks((prev) => [...prev, task]);
      pushToast("success", "Task added");
    } catch {
      pushToast("danger", "Couldn't add task");
      void refetch();
    }
  }

  async function editTask(id: number, draft: TaskDraft) {
    const before = tasks;
    const fields = draftToFields(draft);
    setTasks((prev) => {
      const cur = prev.find((t) => t.id === id);
      const next = prev.map((t) => (t.id === id ? { ...t, title: draft.title, ...fields } : t));
      // If the column changed, append to the end of the new column.
      return cur && cur.status !== draft.status
        ? reorder(next, id, draft.status, Number.MAX_SAFE_INTEGER)
        : next;
    });
    try {
      const res = await fetch(`/api/admin/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) throw new Error();
      pushToast("info", "Task updated");
    } catch {
      setTasks(before);
      pushToast("danger", "Couldn't update task");
      void refetch();
    }
  }

  async function deleteTask(id: number) {
    const before = tasks;
    setTasks((prev) => prev.filter((t) => t.id !== id));
    pushToast("warning", "Task deleted");
    try {
      const res = await fetch(`/api/admin/tasks/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setTasks(before);
      pushToast("danger", "Couldn't delete task");
      void refetch();
    }
  }

  async function moveTask(id: number, status: KanbanStatus, index: number) {
    const before = tasks;
    const moved = before.find((t) => t.id === id);
    if (!moved) return;
    // No-op guard: dropped exactly where it already is.
    const sameColumn = moved.status === status;
    if (sameColumn) {
      const col = byColumn(status);
      const curIdx = col.findIndex((t) => t.id === id);
      if (curIdx === index || curIdx === -1) return;
    }
    setTasks((prev) => reorder(prev, id, status, index));
    try {
      const res = await fetch(`/api/admin/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, position: index }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setTasks(before);
      pushToast("danger", "Couldn't move task");
      void refetch();
    }
  }

  // ---------- Drag & drop ----------

  function onDragStart(e: React.DragEvent, id: number) {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(id));
  }
  function onDragEnd() {
    setDragId(null);
    setDragOverCol(null);
  }
  function dropIndex(listEl: HTMLElement, clientY: number, ignoreId: number): number {
    const cards = Array.from(listEl.querySelectorAll<HTMLElement>("[data-card-id]")).filter(
      (el) => Number(el.dataset.cardId) !== ignoreId,
    );
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return i;
    }
    return cards.length;
  }
  function onDrop(e: React.DragEvent, status: KanbanStatus) {
    e.preventDefault();
    setDragOverCol(null);
    const id = dragId ?? Number(e.dataTransfer.getData("text/plain"));
    if (!id) return;
    const index = dropIndex(e.currentTarget as HTMLElement, e.clientY, id);
    void moveTask(id, status, index);
    setDragId(null);
  }

  // ---------- Modal ----------

  function resetDraftFields() {
    setDraftDescription("");
    setDraftContributor("");
    setDraftDueDate("");
    setDraftCategory("");
    setDraftTicketSize("");
  }

  const openCreate = useCallback((status: KanbanStatus) => {
    setEditingId(null);
    setDraftTitle("");
    setDraftStatus(status);
    resetDraftFields();
    setTitleError(false);
    setModalOpen(true);
  }, []);

  function openEdit(task: KanbanTask) {
    setEditingId(task.id);
    setDraftTitle(task.title);
    setDraftStatus(task.status);
    setDraftDescription(task.description ?? "");
    setDraftContributor(task.contributor ?? "");
    setDraftDueDate(task.dueDate ? task.dueDate.slice(0, 10) : "");
    setDraftCategory(task.category ?? "");
    setDraftTicketSize(task.ticketSize ?? "");
    setTitleError(false);
    setModalOpen(true);
  }

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setEditingId(null);
  }, []);

  function saveModal() {
    const title = draftTitle.trim();
    if (!title) {
      setTitleError(true);
      titleRef.current?.focus();
      return;
    }
    const draft: TaskDraft = {
      title,
      status: draftStatus,
      description: draftDescription,
      contributor: draftContributor,
      dueDate: draftDueDate,
      category: draftCategory,
      ticketSize: draftTicketSize,
    };
    if (editingId !== null) editTask(editingId, draft);
    else createTask(draft);
    closeModal();
  }

  // Focus the title field when the modal opens; close on Escape.
  useEffect(() => {
    if (modalOpen) titleRef.current?.focus();
  }, [modalOpen]);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && modalOpen) closeModal();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen, closeModal]);

  return (
    <div className="flex min-h-[calc(100vh-5rem)] flex-col">
      {/* Topbar */}
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Project Board</h1>
        <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent">Admin</span>
        <p className="w-full text-sm text-muted sm:w-auto sm:flex-1">
          Internal team board — visible to admins only.
        </p>
        <button onClick={() => openCreate("todo")} className="btn-primary">
          + New task
        </button>
      </header>

      {/* Board */}
      <div className="-mx-1 flex-1 overflow-x-auto px-1 pb-4">
        <div className="grid auto-cols-[minmax(280px,1fr)] grid-flow-col gap-5 items-start">
          {KANBAN_COLUMNS.map((col) => {
            const cards = byColumn(col.id);
            const over = dragOverCol === col.id;
            return (
              <section key={col.id} className="card flex flex-col">
                <div className="flex items-center gap-2 border-b border-line-subtle px-5 py-4">
                  <span className={`h-2.5 w-2.5 rounded-full ${DOT[col.id]}`} />
                  <h2 className="text-sm font-semibold text-ink">{col.title}</h2>
                  <span className="ml-auto rounded-full bg-surface-soft px-2 py-0.5 text-xs font-medium text-muted">
                    {cards.length}
                  </span>
                </div>

                <div
                  data-col={col.id}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverCol(col.id);
                  }}
                  onDragLeave={(e) => {
                    // Only clear when leaving the list, not when moving over a child.
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverCol(null);
                  }}
                  onDrop={(e) => onDrop(e, col.id)}
                  className={`flex min-h-[80px] flex-1 flex-col gap-3 p-4 transition-colors ${
                    over ? "bg-accent-soft/50" : ""
                  }`}
                >
                  {cards.map((task) => {
                    const creator = task.creatorName ?? adminName;
                    const overdue = !!task.dueDate && isOverdue(task.dueDate) && task.status !== "done";
                    return (
                      <article
                        key={task.id}
                        data-card-id={task.id}
                        draggable
                        onDragStart={(e) => onDragStart(e, task.id)}
                        onDragEnd={onDragEnd}
                        onDoubleClick={() => openEdit(task)}
                        className={`group cursor-grab rounded-md border border-line bg-surface p-4 shadow-card transition-shadow hover:shadow-md active:cursor-grabbing ${
                          dragId === task.id ? "opacity-40" : ""
                        }`}
                      >
                        <p className="line-clamp-2 text-sm font-medium leading-snug text-ink">{task.title}</p>

                        {(task.ticketSize || task.category) && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {task.ticketSize && (
                              <span
                                title={`Ticket size: ${TICKET_SIZE_LABEL[task.ticketSize]}`}
                                className={`inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-[11px] font-medium ${toneSoft.neutral}`}
                              >
                                <span
                                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneBar[TICKET_TONE[task.ticketSize]]}`}
                                  aria-hidden="true"
                                />
                                {TICKET_SIZE_LABEL[task.ticketSize]}
                              </span>
                            )}
                            {task.category && (
                              <span
                                title={task.category}
                                className={`max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-medium ${toneSoft.neutral}`}
                              >
                                {task.category}
                              </span>
                            )}
                          </div>
                        )}

                        <div className="mt-3 flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="flex -space-x-1.5">
                              <span
                                title={`Creator: ${creator}`}
                                aria-label={`Creator: ${creator}`}
                                className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent ring-2 ring-surface"
                              >
                                <span aria-hidden="true">{initialsOf(creator)}</span>
                              </span>
                              {task.contributor && (
                                <span
                                  title={`Contributor: ${task.contributor}`}
                                  aria-label={`Contributor: ${task.contributor}`}
                                  className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-soft text-[11px] font-semibold text-muted ring-2 ring-surface"
                                >
                                  <span aria-hidden="true">{initialsOf(task.contributor)}</span>
                                </span>
                              )}
                            </div>
                            {task.dueDate && (
                              <span
                                className={`inline-flex items-center gap-1 truncate text-xs font-medium ${
                                  overdue ? "text-danger" : "text-muted"
                                }`}
                                title={overdue ? "Overdue" : "Due date"}
                                aria-label={`${overdue ? "Overdue, due" : "Due"} ${formatDue(task.dueDate)}`}
                              >
                                <svg
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  aria-hidden="true"
                                >
                                  <rect x="3" y="4" width="18" height="18" rx="2" />
                                  <path d="M16 2v4M8 2v4M3 10h18" />
                                </svg>
                                {formatDue(task.dueDate)}
                              </span>
                            )}
                          </div>
                          <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                            <IconButton label="Edit task" onClick={() => openEdit(task)}>
                              <path d="M4 20h4l10-10-4-4L4 16v4Z" />
                              <path d="M13.5 6.5l4 4" />
                            </IconButton>
                            <IconButton label="Delete task" danger onClick={() => deleteTask(task.id)}>
                              <path d="M5 7h14M10 7V5h4v2M6 7l1 12h10l1-12" />
                            </IconButton>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>

                <button
                  onClick={() => openCreate(col.id)}
                  className="m-4 mt-0 flex items-center justify-start rounded-md px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-accent-soft hover:text-accent"
                >
                  + Add task
                </button>
              </section>
            );
          })}
        </div>
      </div>

      {/* Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ backgroundColor: "rgb(22 22 25 / 0.55)" }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-line-subtle bg-surface shadow-lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-modal-title"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-line-subtle px-6 py-4">
              <h3 id="task-modal-title" className="text-lg font-semibold text-ink">{editingId !== null ? "Edit task" : "New task"}</h3>
              <button
                type="button"
                onClick={closeModal}
                aria-label="Close"
                className="rounded-sm text-faint outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-accent-ring"
              >
                ✕
              </button>
            </div>
            <div className="space-y-4 overflow-y-auto px-6 py-5">
              <div>
                <label className="label" htmlFor="task-title">Task title</label>
                <input
                  id="task-title"
                  ref={titleRef}
                  className="field"
                  value={draftTitle}
                  onChange={(e) => {
                    setDraftTitle(e.target.value);
                    if (titleError) setTitleError(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      saveModal();
                    }
                  }}
                  placeholder="e.g. Draft Q3 roadmap"
                  maxLength={200}
                />
                {titleError && <p className="mt-1 text-xs text-danger">Give the task a title.</p>}
              </div>

              <div>
                <label className="label" htmlFor="task-desc">Description</label>
                <textarea
                  id="task-desc"
                  className="field min-h-[88px] resize-y"
                  value={draftDescription}
                  onChange={(e) => setDraftDescription(e.target.value)}
                  placeholder="Add more detail about this task…"
                  maxLength={2000}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="task-column">Column</label>
                  <select
                    id="task-column"
                    className="field"
                    value={draftStatus}
                    onChange={(e) => setDraftStatus(e.target.value as KanbanStatus)}
                  >
                    {KANBAN_COLUMNS.map((c) => (
                      <option key={c.id} value={c.id}>{c.title}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="task-size">Ticket size</label>
                  <select
                    id="task-size"
                    className="field"
                    value={draftTicketSize}
                    onChange={(e) => setDraftTicketSize(e.target.value as TicketSize | "")}
                  >
                    <option value="">— None —</option>
                    {TICKET_SIZES.map((s) => (
                      <option key={s} value={s}>{TICKET_SIZE_LABEL[s]}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="task-due">Due date</label>
                  <input
                    id="task-due"
                    type="date"
                    className="field"
                    value={draftDueDate}
                    onChange={(e) => setDraftDueDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="task-category">Category</label>
                  <input
                    id="task-category"
                    className="field"
                    value={draftCategory}
                    onChange={(e) => setDraftCategory(e.target.value)}
                    placeholder="e.g. Design"
                    maxLength={40}
                  />
                </div>
              </div>

              <div>
                <label className="label" htmlFor="task-contributor">Contributor</label>
                <input
                  id="task-contributor"
                  className="field"
                  value={draftContributor}
                  onChange={(e) => setDraftContributor(e.target.value)}
                  placeholder="e.g. Priya Jain"
                  maxLength={60}
                />
              </div>
            </div>
            <div className="flex shrink-0 justify-end gap-3 border-t border-line-subtle px-6 py-4">
              <button onClick={closeModal} className="btn-ghost">Cancel</button>
              <button onClick={saveModal} className="btn-primary">Save task</button>
            </div>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div className="fixed bottom-6 right-6 z-50 flex max-w-sm flex-col gap-3">
        {toasts.map((t) => (
          <div key={t.id} className="flex items-start gap-3 rounded-md border border-line-subtle bg-surface px-4 py-3 shadow-md">
            <span className={`mt-0.5 h-full w-1 self-stretch rounded-full ${toneBar[t.kind]}`} />
            <p className="text-sm font-semibold text-ink">{t.title}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function IconButton({
  children,
  label,
  onClick,
  danger = false,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-sm text-faint outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent-ring ${
        danger ? "hover:bg-danger-soft hover:text-danger" : "hover:bg-accent-soft hover:text-accent"
      }`}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  );
}
