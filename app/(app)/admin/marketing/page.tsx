import { notFound } from "next/navigation";
import { getAdminUser } from "@/lib/admin";
import { KanbanBoard } from "@/components/KanbanBoard";
import { loadKanbanTasks } from "@/lib/adminTasks";
import { ensureMarketingBoardSeeded } from "@/lib/marketingSeed";

export const dynamic = "force-dynamic";

// Admin-only marketing board ("markKhanban"). A separate lane of AdminTask rows
// (board = "marketing") that reuses the exact same KanbanBoard UI as the build
// board. The launch tickets seed themselves the first time this page is opened
// (idempotent), so there's no manual setup step.
export default async function MarketingBoardPage() {
  const admin = await getAdminUser();
  if (!admin) notFound();

  await ensureMarketingBoardSeeded();
  const tasks = await loadKanbanTasks([{ status: "asc" }, { position: "asc" }], "marketing");

  return (
    <KanbanBoard
      initial={tasks}
      adminName={admin.fullName}
      nowMs={Date.now()}
      board="marketing"
      title="Marketing Board"
      blurb="Launch & marketing work — click a ticket to open it. Drag between columns to move it."
    />
  );
}
