import { notFound } from "next/navigation";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { BurndownChart } from "@/components/BurndownChart";
import { KANBAN_TASK_SELECT, toKanbanTask } from "@/lib/kanban";

export const dynamic = "force-dynamic";

// Admin-only burndown. Reads the same board as the Kanban/hierarchy, so the
// total and the completed line track the cards exactly.
export default async function BurndownPage() {
  const admin = await getAdminUser();
  if (!admin) notFound();

  const rows = await prisma.adminTask.findMany({
    orderBy: [{ ticketNumber: "asc" }, { position: "asc" }],
    select: KANBAN_TASK_SELECT,
  });

  return <BurndownChart tasks={rows.map(toKanbanTask)} nowMs={Date.now()} />;
}
