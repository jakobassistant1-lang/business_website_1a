import { requirePageAccess } from "@/lib/access";
import { isAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { billingEnabled } from "@/lib/subscription";
import { stripe, reconcileBillingFields, type StripeSubscriptionShape } from "@/lib/stripe";
import { AccountForm } from "@/components/AccountForm";
import { BillingCard } from "@/components/BillingCard";
import { Container } from "@/components/Container";

export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const user = await requirePageAccess(); // #119 gate, re-run per page (see lib/access)
  const { from } = await searchParams;
  const fromPortal = from === "portal";

  // Back from Stripe's portal (#109 cancel / keep / card update): reconcile with
  // Stripe NOW, exactly like /billing/past-due does, so the card reflects what
  // the student just did even if the webhook hasn't landed yet. Fail OPEN — any
  // Stripe error just renders the stored state (with the "may take a minute" hint).
  let current = user;
  if (fromPortal && billingEnabled() && user.stripeSubscriptionId) {
    try {
      const sub = (await stripe().subscriptions.retrieve(user.stripeSubscriptionId)) as unknown as StripeSubscriptionShape;
      const fields = reconcileBillingFields(user, sub); // null = unknown state or unchanged → no write
      if (fields) current = await prisma.user.update({ where: { id: user.id }, data: fields });
    } catch (e) {
      console.error("account reconcile failed", e instanceof Error ? e.message : "unknown error");
    }
  }

  return (
    <Container>
      <AccountForm
        initial={{
          fullName: user.fullName,
          email: user.email,
          phone: user.phone ?? "",
        }}
      />
      {/* #109: plan / trial / next charge / cancel state; nothing while billing is off */}
      <BillingCard user={current} enabled={billingEnabled()} isAdmin={isAdminUser(user)} fromPortal={fromPortal} />
    </Container>
  );
}
