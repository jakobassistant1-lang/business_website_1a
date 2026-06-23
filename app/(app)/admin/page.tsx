import { notFound } from "next/navigation";
import { getAdminUser } from "@/lib/admin";
import { KanbanBoard } from "@/components/KanbanBoard";
import { loadKanbanTasks } from "@/lib/adminTasks";
import { ensureOnboardingBacklogSeeded } from "@/lib/onboardingSeed";

export const dynamic = "force-dynamic";

// Admin-only team board. The admin route-group layout already gates non-admins
// (404); this re-resolves the user for their name (free — getCurrentUser is
// request-cached) and keeps a defensive check.
export default async function AdminPage() {
  const admin = await getAdminUser();
  if (!admin) notFound();

  // Additively top up the value-first onboarding-revamp tickets (idempotent; only
  // creates ticket numbers that don't exist yet — never touches the team's cards).
  await ensureOnboardingBacklogSeeded();
  const tasks = await loadKanbanTasks([{ status: "asc" }, { position: "asc" }]);
  return <KanbanBoard initial={tasks} adminName={admin.fullName} nowMs={Date.now()} />;
}
