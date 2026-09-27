import { notFound } from "next/navigation";
import { getAdminUser } from "@/lib/admin";
import { requirePageAccess } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { ymd } from "@/lib/calendarDates";
import { standupHistoryQuery, toStandupDto } from "@/lib/standup";
import { StandupLog } from "@/components/StandupLog";

export const dynamic = "force-dynamic";

// Ticket #46 — admin-only daily standup log (today's entry + 60-day history).
// The admin route-group layout already 404s non-admins; this re-runs the #119
// gate and keeps the same defensive admin check as the other admin pages. The
// history is read here (not via the API) so first paint needs no client fetch.
export default async function StandupPage() {
  await requirePageAccess(); // #119 gate, re-run per page (admins are exempt inside accessDecision)
  const admin = await getAdminUser();
  if (!admin) notFound();

  const now = new Date();
  const rows = await prisma.standupEntry.findMany(standupHistoryQuery(now));
  return (
    <StandupLog
      initialEntries={rows.map(toStandupDto)}
      me={{ name: admin.fullName, id: admin.id }}
      serverToday={ymd(now)}
    />
  );
}
