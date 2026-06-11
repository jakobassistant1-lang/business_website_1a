"use client";

// Burndown over the fixed project window (June 1 → June 30, 2026). Points come
// from ticket size (S/M/L → 1/2/3). The TOTAL is the whole live board, so adding
// tickets later just raises the ceiling — no "65/50". `nowMs` arrives from the
// server so SSR + first hydration agree; after mount we switch the "today"
// reckoning to the viewer's LOCAL day so the KPIs match their wall clock.

import { useEffect, useState } from "react";
import { pointsForSize } from "@/lib/kanban";
import { fmtDateUTC } from "@/lib/calendarDates";
import type { KanbanTask } from "@/lib/kanban";

const DAY = 86_400_000;
const START = Date.UTC(2026, 5, 1); // June 1
const END = Date.UTC(2026, 5, 30); // June 30
const WINDOW_DAYS = Math.round((END - START) / DAY);

// Chart geometry (viewBox units).
const W = 720;
const H = 320;
const PAD = { l: 46, r: 20, t: 20, b: 40 };
const PLOT_W = W - PAD.l - PAD.r;
const PLOT_H = H - PAD.t - PAD.b;

export function BurndownChart({ tasks, nowMs }: { tasks: KanbanTask[]; nowMs: number }) {
  // Before mount, reckon "today" in UTC (deterministic → matches the server's
  // SSR). After mount, use the viewer's local day.
  const [clientNow, setClientNow] = useState<number | null>(null);
  useEffect(() => setClientNow(Date.now()), []);
  const now = clientNow ?? nowMs;
  const useLocal = clientNow !== null;
  const dayKey = (ms: number) => {
    const d = new Date(ms);
    return useLocal
      ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      : `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
  };

  const pts = (t: KanbanTask) => pointsForSize(t.ticketSize);
  const total = tasks.reduce((s, t) => s + pts(t), 0);
  const doneTasks = tasks.filter((t) => t.status === "done");
  const completed = doneTasks.reduce((s, t) => s + pts(t), 0);
  const remaining = total - completed;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const windowEnded = now > END;
  const elapsedDays = Math.max(1, Math.min(Math.round((now - START) / DAY), WINDOW_DAYS));
  const avgPerDay = completed / elapsedDays;
  const todayKey = dayKey(now);
  const completedToday = doneTasks.filter((t) => t.completedAt && dayKey(Date.parse(t.completedAt)) === todayKey).reduce((s, t) => s + pts(t), 0);

  // Scales.
  const clampT = (t: number) => Math.max(START, Math.min(t, END));
  const x = (t: number) => PAD.l + ((clampT(t) - START) / (END - START)) * PLOT_W;
  const y = (p: number) => PAD.t + (total > 0 ? 1 - p / total : 1) * PLOT_H;

  // Actual line: total → step down at each completion → flat to "now". EVERY done
  // card contributes a step; a card missing completedAt is treated as finished at
  // the window start (so the line never disagrees with `remaining`).
  const events = doneTasks
    .map((t) => ({ t: t.completedAt ? Date.parse(t.completedAt) : START, p: pts(t) }))
    .sort((a, b) => a.t - b.t);
  const line: Array<[number, number]> = [[START, total]];
  let cum = 0;
  for (const e of events) {
    cum += e.p;
    line.push([e.t, total - cum]);
  }
  line.push([now, total - cum]);
  const actual = line.map(([t, p]) => `${x(t).toFixed(1)},${y(p).toFixed(1)}`).join(" ");
  const ideal = `${x(START).toFixed(1)},${y(total).toFixed(1)} ${x(END).toFixed(1)},${y(0).toFixed(1)}`;

  // Four week bands across the window.
  const bands = [0, 1, 2, 3].map((i) => {
    const s = START + i * 7 * DAY;
    const e = i < 3 ? START + (i + 1) * 7 * DAY : END;
    return { i, s, e, label: `Week ${i + 1}`, dateLabel: fmtDateUTC(s) };
  });

  // Y gridlines at quarters of the total — deduped so tiny totals don't repeat.
  const yTicks = total > 0 ? [...new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * total)))] : [0];

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Burndown</h1>
        <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent">Admin</span>
        <p className="ml-auto text-sm text-muted">
          Jun 1 – Jun 30 · {total} pts total
          {windowEnded && <span className="ml-2 rounded-full bg-surface-soft px-2 py-0.5 text-xs font-medium text-muted">window ended</span>}
        </p>
      </header>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card p-5 sm:col-span-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Points completed</p>
          <p className="mt-1 text-2xl font-bold text-ink">
            {completed}
            <span className="text-base font-medium text-muted"> / {total}</span>
          </p>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-soft">
            <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-muted">{pct}% of the backlog</p>
        </div>
        <div className="card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Avg / day</p>
          <p className="mt-1 text-2xl font-bold text-ink">
            {avgPerDay.toFixed(1)}
            <span className="text-base font-medium text-muted"> pts</span>
          </p>
          <p className="mt-1.5 text-xs text-muted">over {elapsedDays} day{elapsedDays === 1 ? "" : "s"}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Completed today</p>
          <p className="mt-1 text-2xl font-bold text-ink">
            {completedToday}
            <span className="text-base font-medium text-muted"> pts</span>
          </p>
          <p className="mt-1.5 text-xs text-muted">{remaining} pts remaining</p>
        </div>
      </div>

      {/* Chart */}
      <div className="card mt-4 p-5">
        {total === 0 ? (
          <p className="py-16 text-center text-sm text-muted">No sized tickets yet.</p>
        ) : (
          <>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Burndown: ${completed} of ${total} points complete`}>
              {/* Week bands (alternating tint so each week reads distinctly) */}
              {bands.map((b) => (
                <g key={b.i}>
                  <rect x={x(b.s)} y={PAD.t} width={x(b.e) - x(b.s)} height={PLOT_H} fill={`rgb(var(--accent) / ${b.i % 2 === 0 ? 0.05 : 0.1})`} />
                  <text x={x(b.s) + 6} y={PAD.t + 14} className="fill-muted" fontSize="10" fontWeight="600">
                    {b.label}
                  </text>
                  <text x={x(b.s) + 6} y={H - PAD.b + 14} className="fill-faint" fontSize="9">
                    {b.dateLabel}
                  </text>
                </g>
              ))}
              {/* Y gridlines + labels */}
              {yTicks.map((p) => (
                <g key={p}>
                  <line x1={PAD.l} y1={y(p)} x2={W - PAD.r} y2={y(p)} stroke="rgb(var(--line) / 0.7)" strokeWidth="1" strokeDasharray="2 3" />
                  <text x={PAD.l - 6} y={y(p) + 3} textAnchor="end" className="fill-faint" fontSize="9">
                    {p}
                  </text>
                </g>
              ))}
              {/* Ideal line */}
              <polyline points={ideal} fill="none" stroke="rgb(var(--muted))" strokeWidth="1.5" strokeDasharray="5 4" opacity="0.5" />
              {/* Today marker (only while inside the window) */}
              {now >= START && now <= END && (
                <line x1={x(now)} y1={PAD.t} x2={x(now)} y2={PAD.t + PLOT_H} stroke="rgb(var(--accent) / 0.45)" strokeWidth="1" strokeDasharray="3 3" />
              )}
              {/* Actual burndown */}
              <polyline points={actual} fill="none" stroke="rgb(var(--accent))" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
              <circle cx={x(line[line.length - 1][0])} cy={y(total - cum)} r="3.5" fill="rgb(var(--accent))" />
            </svg>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0.5 w-5 rounded bg-accent" /> Actual
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-px w-5 border-t border-dashed border-muted/60" /> Ideal
              </span>
              <span className="ml-auto">Points remaining vs. date</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
