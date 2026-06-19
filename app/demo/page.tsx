import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { buildDemoCalendarData } from "@/lib/demoData";
import { studySessionsFor } from "@/lib/study";
import { upcomingAssessments } from "@/lib/calendarData";
import { DemoExperience } from "@/components/DemoExperience";

export const dynamic = "force-dynamic";

// The first-run DEMO. Logged-in students land here (the / redirect sends them
// when onboardedAt is null); it shows the real app populated with sample data.
// Building the payload + the Study-hub props happens here on the server (so
// lib/study's node-only imports never reach the client bundle).
export default async function DemoPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { data, todayYmd } = buildDemoCalendarData();
  const firstName = user.fullName?.split(" ")[0] ?? "";

  // Same Study-hub list as /study (shared helper so they never drift).
  const studyAssessments = upcomingAssessments(data);

  const studySessions: Record<number, { date: string; hours: number }[]> = {};
  for (const it of studyAssessments) studySessions[it.canvasId] = studySessionsFor(data.plan, it.canvasId);

  return (
    <DemoExperience
      data={data}
      todayYmd={todayYmd}
      firstName={firstName}
      studyAssessments={studyAssessments}
      studySessions={studySessions}
    />
  );
}
