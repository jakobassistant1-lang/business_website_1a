import { requirePageAccess } from "@/lib/access";
import { SettingsForm } from "@/components/SettingsForm";
import { Container } from "@/components/Container";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requirePageAccess(); // #119 gate, re-run per page (see lib/access)
  return (
    <Container>
      <SettingsForm
        initial={{
          defaultHoursPerDay: user.defaultHoursPerDay,
          studyDaysTest: user.studyDaysTest,
          studyDaysQuiz: user.studyDaysQuiz,
        }}
      />
    </Container>
  );
}
