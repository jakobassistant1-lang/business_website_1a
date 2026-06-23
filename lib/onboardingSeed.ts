// Server-only: additively seed the value-first onboarding-revamp tickets onto the
// BUILD board. Unlike the marketing seed (which fills an empty lane once), this
// TOPS UP an already-seeded board — it creates only the onboarding ticket numbers
// (101+) that don't exist yet and NEVER edits, moves, or removes existing cards, so
// the team's in-progress work is always safe. Idempotent: re-running is a no-op once
// every ticket exists. Pure data lives in lib/onboardingBacklog (no Prisma import).
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { ONBOARDING_BACKLOG } from "./onboardingBacklog";

export async function ensureOnboardingBacklogSeeded(): Promise<void> {
  const numbers = ONBOARDING_BACKLOG.map((t) => t.number);
  const existing = await prisma.adminTask.findMany({
    where: { board: "build", ticketNumber: { in: numbers } },
    select: { ticketNumber: true },
  });
  const have = new Set(existing.map((r) => r.ticketNumber));
  const missing = ONBOARDING_BACKLOG.filter((t) => !have.has(t.number));
  if (missing.length === 0) return;

  // Append each new card to the END of its column so existing cards keep their
  // order/positions. Seed in build-number order within each column.
  const posInColumn = new Map<string, number>();
  for (const status of Array.from(new Set(missing.map((t) => t.status)))) {
    posInColumn.set(status, await prisma.adminTask.count({ where: { board: "build", status } }));
  }

  try {
    await prisma.adminTask.createMany({
      data: missing.map((t) => {
        const position = posInColumn.get(t.status) ?? 0;
        posInColumn.set(t.status, position + 1);
        return {
          board: "build",
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
        };
      }),
    });
  } catch (e) {
    // A concurrent board open seeded first — the [board, ticketNumber] unique
    // rejects the duplicate. Safe to treat as already-seeded.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return;
    throw e;
  }
}
