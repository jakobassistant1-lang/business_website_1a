import { notFound } from "next/navigation";
import { getAdminUser } from "@/lib/admin";
import { requirePageAccess } from "@/lib/access";
import { BurndownChart } from "@/components/BurndownChart";
import { loadKanbanTasks } from "@/lib/adminTasks";

export const dynamic = "force-dynamic";

// Admin-only burndown. Reads the same board as the Kanban/hierarchy, so the
// total and the completed line track the cards exactly.
export default async function BurndownPage() {
  await requirePageAccess(); // #119 gate, re-run per page (admins are exempt inside accessDecision)
  const admin = await getAdminUser();
  if (!admin) notFound();

  const tasks = await loadKanbanTasks([{ ticketNumber: "asc" }, { position: "asc" }]);
  return <BurndownChart tasks={tasks} nowMs={Date.now()} />;
}
