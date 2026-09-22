import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin";
import { billingEnabled, needsCheckout } from "@/lib/subscription";
import { priceDisplay, trialDaysFor } from "@/lib/stripe";
import { CheckoutEmbed } from "@/components/CheckoutEmbed";
import { formatDateHuman } from "@/lib/calendarDates";

export const dynamic = "force-dynamic";

// /welcome/card — the card step (#118): signup → demo → HERE → app. Our page,
// our trust copy, Stripe's Embedded Checkout inside (the student never leaves
// the site; the card fields live in Stripe's iframe, never on our servers).
export default async function CardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!billingEnabled() || isAdminUser(user) || !needsCheckout(user.subscriptionStatus)) redirect("/dashboard");
  if (!user.onboardedAt) redirect("/demo"); // demo first (Calvin's flow), card after

  const price = await priceDisplay(); // read from Stripe — never hardcoded
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
  // First-timers get the free week; a returning (canceled) subscriber is charged
  // today — the SAME rule Stripe is given (trialDaysFor), so copy and charge agree.
  const trialDays = trialDaysFor(user);
  const chargeDate = formatDateHuman(Date.now() + (trialDays ?? 0) * 86_400_000, { weekday: true });

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <p className="text-[13px] font-semibold uppercase tracking-wider text-muted">
        Step 1 of 2 · Payment <span className="mx-1 text-faint">→</span> <span className="text-faint">Connect Canvas</span>
      </p>
      <h1 className="mt-2 text-[26px] font-bold tracking-tight text-ink">{trialDays ? "Start your free week" : "Restart Navo"}</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        {trialDays ? (
          <>
            {price} after a {trialDays}-day free trial. <span className="font-medium text-ink">You won&apos;t be charged until {chargeDate}</span> — we&apos;ll
            email you before that, and you can cancel in one click anytime.
          </>
        ) : (
          <>
            {price}, <span className="font-medium text-ink">charged today</span>. Cancel anytime.
          </>
        )}{" "}
        Questions? Email{" "}
        <a href="mailto:support@navolearning.com" className="font-medium text-accent hover:underline">support@navolearning.com</a>{" "}
        — a founder reads every message.
      </p>
      <div className="card mt-6 p-2 sm:p-4">
        <CheckoutEmbed publishableKey={publishableKey} trialDays={trialDays ?? 0} />
      </div>
    </main>
  );
}
