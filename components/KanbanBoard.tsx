"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KANBAN_COLUMNS, KANBAN_STATUSES, type KanbanStatus, type KanbanTask } from "@/lib/kanban";
import { toneBar } from "@/lib/tone";

type ToastKind = "success" | "info" | "warning" | "danger";
interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
}

// Per-column accent dot.
const DOT: Record<KanbanStatus, string> = {
  todo: "bg-faint",
  progress: "bg-accent",
  review: "bg-warning",
  done: "bg-success",
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "AD";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
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
  const [titleError, setTitleError] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const toastSeq = useRef(0);
  const toastTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const avatar = initialsOf(adminName);

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

  async function createTask(title: string, status: KanbanStatus) {
    try {
      const res = await fetch("/api/admin/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, status }),
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

  async function editTask(id: number, title: string, status: KanbanStatus) {
    const before = tasks;
    setTasks((prev) => {
      const cur = prev.find((t) => t.id === id);
      const next = prev.map((t) => (t.id === id ? { ...t, title } : t));
      // If the column changed, append to the end of the new column.
      return cur && cur.status !== status ? reorder(next, id, status, Number.MAX_SAFE_INTEGER) : next;
    });
    try {
      const res = await fetch(`/api/admin/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, status }),
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

  const openCreate = useCallback((status: KanbanStatus) => {
    setEditingId(null);
    setDraftTitle("");
    setDraftStatus(status);
    setTitleError(false);
    setModalOpen(true);
  }, []);

  function openEdit(task: KanbanTask) {
    setEditingId(task.id);
    setDraftTitle(task.title);
    setDraftStatus(task.status);
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
    if (editingId !== null) editTask(editingId, title, draftStatus);
    else createTask(title, draftStatus);
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
                  {cards.map((task) => (
                    <article
                      key={task.id}
                      data-card-id={task.id}
                      draggable
                      onDragStart={(e) => onDragStart(e, task.id)}
                      onDragEnd={onDragEnd}
                      className={`group cursor-grab rounded-md border border-line bg-surface p-4 shadow-card transition-shadow hover:shadow-md active:cursor-grabbing ${
                        dragId === task.id ? "opacity-40" : ""
                      }`}
                    >
                      <p className="text-sm font-medium leading-snug text-ink">{task.title}</p>
                      <div className="mt-3 flex items-center justify-between">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">
                          {avatar}
                        </span>
                        <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
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
                  ))}
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
          <div className="w-full max-w-md rounded-2xl border border-line-subtle bg-surface shadow-lg" role="dialog" aria-modal="true">
            <div className="flex items-center justify-between border-b border-line-subtle px-6 py-4">
              <h3 className="text-lg font-semibold text-ink">{editingId !== null ? "Edit task" : "New task"}</h3>
              <button onClick={closeModal} aria-label="Close" className="text-faint transition-colors hover:text-ink">
                ✕
              </button>
            </div>
            <div className="space-y-4 px-6 py-5">
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
            </div>
            <div className="flex justify-end gap-3 border-t border-line-subtle px-6 py-4">
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
      className={`flex h-7 w-7 items-center justify-center rounded-sm text-faint transition-colors ${
        danger ? "hover:bg-danger-soft hover:text-danger" : "hover:bg-accent-soft hover:text-accent"
      }`}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  );
}
