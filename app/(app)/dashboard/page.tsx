import { requirePageAccess } from "@/lib/access";
import { loadCalendarData } from "@/lib/calendarData";
import { inFirstsCohort, logFirst } from "@/lib/funnel";
import { ymd } from "@/lib/calendarDates";
import { DashboardView } from "@/components/DashboardView";
import { WelcomeNudge } from "@/components/WelcomeNudge";

export const dynamic = "force-dynamic";

// Home after login: a calm, glanceable dashboard distilled from the same data
// the Calendar/Timeline use — it links into them for the detail.
export default async function DashboardPage() {
  const user = await requirePageAccess(); // #119 gate, re-run per page (see lib/access)
  const data = await loadCalendarData(user.id);
  // #111 activation: the first time a NEW user (signed up since the milestone
  // shipped — no query for anyone older) sees a plan built from a completed
  // sync, even an empty one. Costs one indexed findFirst per visit until the
  // row exists, then nothing new. Awaited (Vercel freezes after the response);
  // logFirst never throws and the catch is belt-and-braces for the page.
  if (data.syncedAt && inFirstsCohort(user.createdAt)) {
    await logFirst("first_plan_rendered", user.id, { items: data.items.length }).catch(() => {});
  }
  const firstName = user.fullName.trim().split(/\s+/)[0] ?? "";
  return (
    <>
      <DashboardView data={data} todayYmd={ymd(new Date())} firstName={firstName} />
      <WelcomeNudge />
    </>
  );
}
