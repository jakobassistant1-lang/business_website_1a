// One-time seed: replace the admin board with the 24 StudyPlan MVP backlog tickets.
// Run against the live DB with `npx tsx prisma/seed-backlog.ts` (needs DATABASE_URL).
//
// Already-done tickets get a SYNTHETIC completedAt spread evenly (by points) across
// June 1 → June 11 so the burndown shows a consistent average slope — we don't have
// real per-ticket finish dates. New completions (dragging a card to Done) stamp the
// real time, so the chart self-corrects going forward.

import { PrismaClient } from "@prisma/client";
import { BACKLOG } from "../lib/backlog";
import { TICKET_POINTS } from "../lib/kanban";

const prisma = new PrismaClient();

const START = new Date(Date.UTC(2026, 5, 1)); // June 1, 2026 — project start
const TODAY = new Date(Date.UTC(2026, 5, 11)); // June 11, 2026 — "now" per the team
const SPAN_MS = TODAY.getTime() - START.getTime();

function syntheticCompletions(): Map<number, Date> {
  const done = BACKLOG.filter((t) => t.status === "done").sort((a, b) => a.number - b.number);
  const total = done.reduce((s, t) => s + TICKET_POINTS[t.size], 0);
  const out = new Map<number, Date>();
  let cum = 0;
  for (const t of done) {
    const pts = TICKET_POINTS[t.size];
    // Place each completion at the MIDPOINT of its point-slice → even spacing, a
    // consistent slope, and nothing lands exactly on "today" (so "completed today"
    // starts at 0 until real activity).
    const frac = total > 0 ? (cum + pts / 2) / total : 0;
    out.set(t.number, new Date(START.getTime() + frac * SPAN_MS));
    cum += pts;
  }
  return out;
}

async function main() {
  // Idempotent: this runs in the Vercel build, so guard it to seed EXACTLY once.
  // Once any numbered ticket exists the board is the source of truth — never wipe
  // the team's work on a later deploy.
  const alreadySeeded = await prisma.adminTask.count({ where: { ticketNumber: { not: null } } });
  if (alreadySeeded > 0) {
    console.log(`Backlog already seeded (${alreadySeeded} numbered tickets) — skipping.`);
    return;
  }

  const completedAt = syntheticCompletions();
  // Position is PER-COLUMN and 0-based (BACKLOG is in build-number order, so each
  // column keeps that order). The board/API treat position as a 0-based slot.
  const posInColumn = new Map<string, number>();
  const removed = await prisma.adminTask.deleteMany({});
  await prisma.adminTask.createMany({
    data: BACKLOG.map((t) => {
      const position = posInColumn.get(t.status) ?? 0;
      posInColumn.set(t.status, position + 1);
      return {
        title: t.title,
        description: t.scope,
        status: t.status,
        position,
        ticketSize: t.size,
        ticketNumber: t.number,
        goal: t.goal,
        subgoal: t.subgoal,
        acceptance: t.acceptance,
        dependencies: t.dependencies,
        completedAt: t.status === "done" ? completedAt.get(t.number) ?? null : null,
      };
    }),
  });
  const n = await prisma.adminTask.count();
  console.log(`Cleared ${removed.count} old card(s); seeded ${n} backlog tickets.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
