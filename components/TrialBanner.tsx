import Link from "next/link";
import { billingEnabled, isTrialing, trialBannerText, trialDaysLeft } from "@/lib/subscription";
import { loadTrialPrice } from "@/lib/trialTerms";

/** App-wide trial notice (#110): honest, quiet, and only ever shown to a student
 *  who is actually mid-trial. Renders NOTHING when billing is off (prod today,
 *  BILLING_ENABLED unset), for admins, for any non-trialing status, when we have
 *  no trial end date to count from, or once the trial has run out (day 0 — the
 *  status flip is what should move them, not a "0 days left" banner).
 *
 *  All the wording lives in the pure trialBannerText (lib/subscription), so the
 *  cancel-scheduled branch and the day boundaries are unit-tested. The price is
 *  read from Stripe (loadTrialPrice — timed out and negatively cached, so the
 *  page never waits on it) and is never hardcoded. */
export async function TrialBanner({
  user,
  isAdmin,
}: {
  user: { subscriptionStatus: string | null; trialEndsAt: Date | string | null; cancelAtPeriodEnd?: boolean | null };
  isAdmin: boolean;
}) {
  if (!billingEnabled() || isAdmin) return null;
  if (!isTrialing(user.subscriptionStatus)) return null;
  const daysLeft = trialDaysLeft(user.trialEndsAt, new Date());
  // Same rule as trialBannerText's null case, applied before the price read so a
  // spent trial costs no Stripe call at all.
  if (daysLeft === null || daysLeft <= 0) return null;

  const price = await loadTrialPrice();
  const text = trialBannerText({ daysLeft, price, cancelAtPeriodEnd: user.cancelAtPeriodEnd });
  if (!text) return null;

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-soft px-4 py-2.5 text-[13px] text-muted">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
      <p>
        {text}{" "}
        <Link href="/account" className="font-medium text-accent hover:text-accent-hover">
          Manage in Account
        </Link>
        .
      </p>
    </div>
  );
}
