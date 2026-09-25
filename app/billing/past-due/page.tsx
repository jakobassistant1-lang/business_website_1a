import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { accessDecision, billingEnabled } from "@/lib/subscription";
import { stripe, reconcileFields } from "@/lib/stripe";
import { UpdatePaymentButton, SignOutLink } from "@/components/BillingScreenActions";

export const dynamic = "force-dynamic";

// /billing/past-due (#119) — shown when the renewal charge failed. Lives OUTSIDE
// the (app) group so the gate can't redirect-loop. If the account is no longer
// past-due (card fixed), fall through to / so a healthy student never sees a
// stale screen.
//
// Reconcile: until webhooks (#109) exist nothing else writes the recovered
// status, so this page asks Stripe for the subscription's current state and
// writes it when it differs. Fail OPEN — any Stripe error just renders the screen.
export default async function PastDuePage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const enabled = billingEnabled();
  const admin = isAdminUser(user);
  if (accessDecision(user, enabled, admin) !== "past_due") redirect("/");

  let current = user;
  if (user.stripeSubscriptionId) {
    try {
      const sub = await stripe().subscriptions.retrieve(user.stripeSubscriptionId);
      const fields = reconcileFields(user, sub); // null = unknown state or unchanged → no write
      if (fields) current = await prisma.user.update({ where: { id: user.id }, data: fields });
    } catch (e) {
      console.error("past-due reconcile failed", e instanceof Error ? e.message : "unknown error");
    }
  }
  // redirect() throws — keep it outside the try so it's never swallowed.
  if (accessDecision(current, enabled, admin) !== "past_due") redirect("/");

  const { from } = await searchParams;
  const fromPortal = from === "portal";

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <p className="text-[13px] font-semibold uppercase tracking-wider text-muted">Billing</p>
      <h1 className="mt-2 text-[26px] font-bold tracking-tight text-ink">Your payment didn&apos;t go through</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        We tried to charge the card on file and it didn&apos;t work — that happens with expired or replaced cards. Your plan is
        paused until the card is updated. <span className="font-medium text-ink">Nothing is deleted</span>: your Canvas
        connection, plans, and notes are all waiting for you.
      </p>
      {fromPortal && (
        <p className="mt-4 text-[14px] text-muted">Card updated? Stripe may take a minute to retry the charge — this page will let you back in as soon as it clears.</p>
      )}
      <div className="card mt-6 p-5 sm:p-6">
        <UpdatePaymentButton />
        <p className="mt-4 text-[14px] text-muted">
          You&apos;ll be taken to a secure Stripe page to update your card, then brought straight back here.
        </p>
      </div>
      <p className="mt-6 text-[14px] text-muted">
        <SignOutLink />
        <span className="mx-2 text-faint">·</span>
        Need a hand? Email{" "}
        <a href="mailto:support@navolearning.com" className="font-medium text-accent hover:underline">support@navolearning.com</a>
        {" "}— a founder reads every message.
      </p>
    </main>
  );
}
