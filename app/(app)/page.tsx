import { getCurrentUser } from "@/lib/auth";
import { loadPlan } from "@/lib/plan";
import { PlanView } from "@/components/PlanView";
import { Container } from "@/components/Container";

export const dynamic = "force-dynamic";

// Default landing view after login (FR-3.2).
export default async function PlanPage() {
  const user = await getCurrentUser();
  const payload = await loadPlan(user!.id); // layout guarantees auth
  return (
    <Container>
      <PlanView initial={payload} />
    </Container>
  );
}
