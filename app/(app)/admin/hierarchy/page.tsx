import { notFound } from "next/navigation";
import { getAdminUser } from "@/lib/admin";
import { HierarchyMap } from "@/components/HierarchyMap";
import { loadKanbanTasks } from "@/lib/adminTasks";

export const dynamic = "force-dynamic";

// Admin-only goal → sub-goal → ticket map. Reads the same AdminTask board the
// Kanban does, so a card moved to Done here shows checked off there too.
export default async function HierarchyPage() {
  const admin = await getAdminUser();
  if (!admin) notFound();

  const tasks = await loadKanbanTasks([{ ticketNumber: "asc" }, { position: "asc" }]);
  return <HierarchyMap tasks={tasks} />;
}
