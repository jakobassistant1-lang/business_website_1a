import { notFound } from "next/navigation";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { KanbanBoard } from "@/components/KanbanBoard";
import { KANBAN_TASK_SELECT, toKanbanTask } from "@/lib/kanban";

export const dynamic = "force-dynamic";

// Admin-only team board. The admin route-group layout already gates non-admins
// (404); this re-resolves the user for their name (free — getCurrentUser is
// request-cached) and keeps a defensive check.
export default async function AdminPage() {
  const admin = await getAdminUser();
  if (!admin) notFound();

  const rows = await prisma.adminTask.findMany({
    orderBy: [{ status: "asc" }, { position: "asc" }],
    select: KANBAN_TASK_SELECT,
  });

  return <KanbanBoard initial={rows.map(toKanbanTask)} adminName={admin.fullName} />;
}
