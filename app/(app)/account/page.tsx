import { getCurrentUser } from "@/lib/auth";
import { isBillingConfigured } from "@/lib/billing";
import { AccountForm } from "@/components/AccountForm";
import { Container } from "@/components/Container";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await getCurrentUser();
  return (
    <Container>
      <AccountForm
        initial={{
          fullName: user!.fullName,
          email: user!.email,
          phone: user!.phone ?? "",
        }}
        // Billing is server-only; pass the resolved flag + status down so the
        // form can show the Subscription section. Both are inert when billing is
        // off (isBillingConfigured() false → the section never renders).
        billingEnabled={isBillingConfigured()}
        subscriptionStatus={user!.subscriptionStatus}
      />
    </Container>
  );
}
