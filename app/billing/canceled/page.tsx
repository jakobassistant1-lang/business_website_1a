import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin";
import { accessDecision, billingEnabled } from "@/lib/subscription";
import { priceDisplay } from "@/lib/stripe";
import { SignOutLink } from "@/components/BillingScreenActions";

export const dynamic = "force-dynamic";

// /billing/canceled (#119) — the subscription ended. Lives OUTSIDE the (app)
// group so the gate can't redirect-loop. Restarting = paying again through the
// normal card step (needsCheckout treats canceled like none). If the account is
// no longer canceled, fall through to / so nobody sees a stale screen.
export default async function CanceledPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (accessDecision(user, billingEnabled(), isAdminUser(user)) !== "canceled") redirect("/");
  // Restarting charges today (no second trial) — say so with the real price.
  // Fail open: if Stripe is unreachable the screen still renders, just without the amount.
  const price = await priceDisplay().catch(() => null);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <p className="text-[13px] font-semibold uppercase tracking-wider text-muted">Billing</p>
      <h1 className="mt-2 text-[26px] font-bold tracking-tight text-ink">Your subscription is canceled</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        You&apos;re not being charged, and <span className="font-medium text-ink">nothing is deleted</span> — your Canvas
        connection, plans, and notes are kept exactly as you left them. Restart any time and pick up where you were.
      </p>
      <div className="card mt-6 p-5 sm:p-6">
        <Link href="/welcome/card" className="btn-primary max-md:tap max-sm:w-full">Restart Navo</Link>
        <p className="mt-4 text-[14px] text-muted">
          Restarting takes a minute: enter a card and you&apos;ll be charged {price ? `${price} ` : ""}today — no second free trial. Cancel anytime.
        </p>
      </div>
      <p className="mt-6 text-[14px] text-muted">
        <SignOutLink />
        <span className="mx-2 text-faint">·</span>
        Questions? Email{" "}
        <a href="mailto:support@navolearning.com" className="font-medium text-accent hover:underline">support@navolearning.com</a>
        {" "}— a founder reads every message.
      </p>
    </main>
  );
}
