// Server-only: seed the marketing board the first time it's opened. Kept separate
// from the pure ticket data (lib/marketingBacklog) so that data stays unit-testable
// without importing Prisma.
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { MARKETING_BACKLOG } from "./marketingBacklog";

/**
 * Seed the marketing board ONCE. Idempotent: if any marketing card already exists
 * we leave the lane alone (the team's edits are the source of truth). The per-board
 * [board, ticketNumber] unique guards a rare double-open race — the second writer
 * hits P2002, which we treat as "already seeded".
 */
export async function ensureMarketingBoardSeeded(): Promise<void> {
  const existing = await prisma.adminTask.count({ where: { board: "marketing" } });
  if (existing > 0) return;

  // Position is per-column and 0-based; MARKETING_BACKLOG is authored in display
  // order, so each column keeps that order.
  const posInColumn = new Map<string, number>();
  try {
    await prisma.adminTask.createMany({
      data: MARKETING_BACKLOG.map((t) => {
        const position = posInColumn.get(t.status) ?? 0;
        posInColumn.set(t.status, position + 1);
        return {
          board: "marketing",
          title: t.title,
          description: t.scope,
          status: t.status,
          position,
          ticketSize: t.size,
          ticketNumber: t.number,
          category: "Marketing",
        };
      }),
    });
  } catch (e) {
    // Another admin opened the board at the same instant and seeded first — the
    // unique constraint rejects the duplicate. Safe to treat as already-seeded.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return;
    throw e;
  }
}
