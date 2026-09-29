import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin";
import { billingEnabled, needsCheckout } from "@/lib/subscription";
import { priceDisplay, trialDaysFor } from "@/lib/stripe";
import { CheckoutEmbed } from "@/components/CheckoutEmbed";
import { formatDateHuman } from "@/lib/calendarDates";
import { PRICE_UNAVAILABLE } from "@/lib/messages";

export const dynamic = "force-dynamic";

// /welcome/card — the card step (#118): signup → demo → HERE → app. Our page,
// our trust copy, Stripe's Embedded Checkout inside (the student never leaves
// the site; the card fields live in Stripe's iframe, never on our servers).
export default async function CardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!billingEnabled() || isAdminUser(user) || !needsCheckout(user.subscriptionStatus)) redirect("/dashboard");
  if (!user.onboardedAt) redirect("/demo"); // demo first (Calvin's flow), card after

  // Read from Stripe — never hardcoded. The card form only renders beside the
  // REAL price: when it can't be read, the page says so and offers a retry.
  const price = await priceDisplay().catch(() => null);
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
  // First-timers get the free trial (TRIAL_DAYS via trialDaysFor); a returning (canceled) subscriber is charged
  // today — the SAME rule Stripe is given (trialDaysFor), so copy and charge agree.
  const trialDays = trialDaysFor(user);
  const chargeDate = formatDateHuman(Date.now() + (trialDays ?? 0) * 86_400_000, { weekday: true });

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <p className="text-[13px] font-semibold uppercase tracking-wider text-muted">
        Step 1 of 2 · Payment <span className="mx-1 text-faint">→</span> <span className="text-faint">Connect Canvas</span>
      </p>
      <h1 className="mt-2 text-[26px] font-bold tracking-tight text-ink">{trialDays ? `Start your ${trialDays}-day free trial` : "Restart Navo"}</h1>
      {!price ? (
        <div className="card mt-6 p-5 sm:p-6">
          <p className="text-[15px] text-ink">{PRICE_UNAVAILABLE}</p>
          {/* A plain link to this page = a reload: the server reads the price again. */}
          <a href="/welcome/card" className="btn-primary mt-4 inline-block max-md:tap max-sm:w-full">Try again</a>
        </div>
      ) : (
      <>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        {trialDays ? (
          <>
            Free for {trialDays} days, then {price}. <span className="font-medium text-ink">You won’t be charged until {chargeDate}</span> — we’ll
            email you before that, and you can cancel in one click anytime.
          </>
        ) : (
          <>
            You’ll be <span className="font-medium text-ink">charged {price} today</span>. Cancel anytime.
          </>
        )}{" "}
        Questions? Email{" "}
        <a href="mailto:support@navolearning.com" className="font-medium text-accent hover:underline">support@navolearning.com</a>{" "}
        — a founder reads every message.
      </p>
      <div className="card mt-6 p-2 sm:p-4">
        <CheckoutEmbed publishableKey={publishableKey} trialDays={trialDays ?? 0} />
      </div>
      </>
      )}
    </main>
  );
}
