import { notFound } from "next/navigation";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { HierarchyMap } from "@/components/HierarchyMap";
import { KANBAN_TASK_SELECT, toKanbanTask } from "@/lib/kanban";

export const dynamic = "force-dynamic";

// Admin-only goal → sub-goal → ticket map. Reads the same AdminTask board the
// Kanban does, so a card moved to Done here shows checked off there too.
export default async function HierarchyPage() {
  const admin = await getAdminUser();
  if (!admin) notFound();

  const rows = await prisma.adminTask.findMany({
    orderBy: [{ ticketNumber: "asc" }, { position: "asc" }],
    select: KANBAN_TASK_SELECT,
  });

  return <HierarchyMap tasks={rows.map(toKanbanTask)} />;
}
