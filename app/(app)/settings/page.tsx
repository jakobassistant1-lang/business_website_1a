import { getCurrentUser } from "@/lib/auth";
import { SettingsForm } from "@/components/SettingsForm";
import { Container } from "@/components/Container";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  return (
    <Container>
      <SettingsForm
        initial={{
          defaultHoursPerDay: user!.defaultHoursPerDay,
          planningWindowDays: user!.planningWindowDays,
          defaultEffortHours: user!.defaultEffortHours,
        }}
      />
    </Container>
  );
}
