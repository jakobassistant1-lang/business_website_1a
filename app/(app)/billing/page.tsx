import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isBillingConfigured } from "@/lib/billing";
import { Container } from "@/components/Container";
import { StartTrialButton } from "./StartTrialButton";

export const dynamic = "force-dynamic";

// Start-your-trial page. Fully INERT when billing is off: with no Stripe env it
// redirects to the dashboard, so the page can never be reached in the live app.
export default async function BillingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!isBillingConfigured()) redirect("/dashboard");

  const plan = process.env.STRIPE_PRICE_DISPLAY ?? "your plan";

  return (
    <Container>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Start your 7-day free trial</h1>
      <p className="mt-1 text-sm text-muted">Try StudyPlan free for a week. No surprises.</p>

      <div className="card mt-6 max-w-xl p-6">
        <p className="text-base text-ink">
          Free for 7 days, then {plan} — cancel anytime in two clicks.
        </p>
        <p className="mt-2 text-sm text-muted">
          We&apos;ll remind you before the trial ends. You won&apos;t be charged until then.
        </p>
        <StartTrialButton />
      </div>
    </Container>
  );
}
