"use client";

// Collapsible goal → sub-goal → ticket map of the whole backlog (folders/subfolders).
// Done tickets (status "done" on the Kanban) show a green check + greyed/struck text,
// so the map stays in lockstep with the board.

import { useState } from "react";
import { GOAL_ORDER } from "@/lib/backlog";
import type { KanbanTask } from "@/lib/kanban";

const CHEVRON = "M9 6l6 6-6 6"; // points right; rotated 90° when expanded

interface SubNode {
  name: string;
  order: number; // min ticket number → stable ordering
  tickets: KanbanTask[];
}
interface GoalNode {
  name: string;
  order: number;
  subs: SubNode[];
  total: number;
  done: number;
}

function buildTree(tasks: KanbanTask[]): GoalNode[] {
  const goals = new Map<string, Map<string, KanbanTask[]>>();
  for (const t of tasks) {
    const g = t.goal ?? "Other";
    const s = t.subgoal ?? "—";
    if (!goals.has(g)) goals.set(g, new Map());
    const subs = goals.get(g)!;
    if (!subs.has(s)) subs.set(s, []);
    subs.get(s)!.push(t);
  }
  const goalRank = (name: string) => {
    const i = GOAL_ORDER.indexOf(name);
    return i === -1 ? GOAL_ORDER.length + 1 : i;
  };
  const num = (t: KanbanTask) => t.ticketNumber ?? Number.MAX_SAFE_INTEGER;
  const nodes: GoalNode[] = [];
  for (const [name, subs] of goals) {
    const subNodes: SubNode[] = [];
    let total = 0;
    let done = 0;
    for (const [sname, tickets] of subs) {
      tickets.sort((a, b) => num(a) - num(b));
      total += tickets.length;
      done += tickets.filter((t) => t.status === "done").length;
      subNodes.push({ name: sname, order: Math.min(...tickets.map(num)), tickets });
    }
    subNodes.sort((a, b) => a.order - b.order);
    nodes.push({ name, order: goalRank(name), subs: subNodes, total, done });
  }
  nodes.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  return nodes;
}

export function HierarchyMap({ tasks }: { tasks: KanbanTask[] }) {
  const tree = buildTree(tasks);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const isOpen = (key: string) => !collapsed.has(key);
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const totalDone = tree.reduce((s, g) => s + g.done, 0);
  const totalAll = tree.reduce((s, g) => s + g.total, 0);

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Hierarchy map</h1>
        <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent">Admin</span>
        <p className="ml-auto text-sm text-muted">
          {totalDone}/{totalAll} tickets done
        </p>
      </header>

      <div className="space-y-3">
        {tree.map((goal) => {
          const gOpen = isOpen(goal.name);
          return (
            <div key={goal.name} className="card overflow-hidden">
              <button
                onClick={() => toggle(goal.name)}
                className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-surface-soft"
              >
                <Chevron open={gOpen} />
                <span className="font-semibold text-ink">{goal.name}</span>
                <span className="ml-auto shrink-0 text-xs font-medium text-muted">
                  {goal.done}/{goal.total}
                </span>
              </button>

              {gOpen && (
                <div className="border-t border-line-subtle">
                  {goal.subs.map((sub) => {
                    const subKey = `${goal.name}|${sub.name}`;
                    const sOpen = isOpen(subKey);
                    const sDone = sub.tickets.filter((t) => t.status === "done").length;
                    return (
                      <div key={subKey} className="border-b border-line-subtle/70 last:border-b-0">
                        <button
                          onClick={() => toggle(subKey)}
                          className="flex w-full items-center gap-2.5 py-2.5 pl-7 pr-4 text-left transition-colors hover:bg-surface-soft"
                        >
                          <Chevron open={sOpen} small />
                          <span className="text-sm font-medium text-ink">{sub.name}</span>
                          <span className="ml-auto shrink-0 text-[11px] font-medium text-faint">
                            {sDone}/{sub.tickets.length}
                          </span>
                        </button>
                        {sOpen && (
                          <ul className="pb-1.5">
                            {sub.tickets.map((t) => {
                              const done = t.status === "done";
                              return (
                                <li key={t.id} className="flex items-center gap-2.5 py-1.5 pl-[3.25rem] pr-4">
                                  {done ? (
                                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-success text-white">
                                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M5 13l4 4L19 7" />
                                      </svg>
                                    </span>
                                  ) : (
                                    <span className="h-4 w-4 shrink-0 rounded-full border-2 border-line" aria-hidden />
                                  )}
                                  {t.ticketNumber != null && (
                                    <span className={`shrink-0 text-[11px] font-semibold tabular-nums ${done ? "text-faint" : "text-muted"}`}>
                                      #{t.ticketNumber}
                                    </span>
                                  )}
                                  <span className={`truncate text-sm ${done ? "text-faint line-through" : "text-ink"}`}>{t.title}</span>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Chevron({ open, small = false }: { open: boolean; small?: boolean }) {
  const s = small ? 14 : 16;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-faint transition-transform ${open ? "rotate-90" : ""}`}
      aria-hidden
    >
      <path d={CHEVRON} />
    </svg>
  );
}
