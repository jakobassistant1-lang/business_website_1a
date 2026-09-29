import { billingCardState, cancelScheduledText, isTrialing } from "@/lib/subscription";
import { priceDisplay } from "@/lib/stripe";
import { formatDateHuman } from "@/lib/calendarDates";
import { PortalButton } from "@/components/BillingScreenActions";

type BillingUser = {
  subscriptionStatus: string | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

const day = (d: Date) => formatDateHuman(d, { weekday: true });

/** The billing card on /account (#109). Server component: what to show is
 *  decided by the pure billingCardState (lib/subscription) — this file holds no
 *  status comparisons. Renders nothing while BILLING_ENABLED is unset, and
 *  nothing for statuses that never reach /account (past_due / canceled are
 *  redirected to their own screens first). The price is read from Stripe
 *  (never hardcoded) and fails open to just "Navo". */
export async function BillingCard({ user, enabled, isAdmin, fromPortal }: { user: BillingUser; enabled: boolean; isAdmin: boolean; fromPortal?: boolean }) {
  const state = billingCardState(user, enabled, isAdmin);
  if (state === "hidden") return null;

  if (state === "grandfathered") {
    return <p className="mt-6 max-w-xl text-sm text-muted">Early member — no subscription needed.</p>;
  }

  const price = await priceDisplay().catch(() => null);
  // A scheduled cancel ends a trial at trialEndsAt (the date the trialing state
  // shows) and a paid subscription at currentPeriodEnd.
  const trialing = isTrialing(user.subscriptionStatus);
  const cancelEnds = trialing ? user.trialEndsAt : user.currentPeriodEnd;
  const plan = price ? `Navo · ${price}` : "Navo";

  return (
    <section className="card mt-6 max-w-xl p-5 sm:p-6" aria-labelledby="billing-heading">
      <h2 id="billing-heading" className="text-base font-semibold text-ink">Billing</h2>
      <p className="mt-1 text-sm text-ink">{plan}</p>

      {state === "trialing" && (
        <>
          {user.trialEndsAt && <p className="mt-3 text-sm text-muted">Free trial ends {day(user.trialEndsAt)}.</p>}
          <div className="mt-4"><PortalButton label="Manage or cancel" /></div>
        </>
      )}
      {state === "active" && (
        <>
          {user.currentPeriodEnd && <p className="mt-3 text-sm text-muted">Next charge {day(user.currentPeriodEnd)}.</p>}
          <div className="mt-4"><PortalButton label="Manage or cancel" /></div>
        </>
      )}
      {state === "cancel_scheduled" && (
        <>
          <p className="mt-3 text-sm text-muted">
            {cancelScheduledText({ trialing, endsOn: cancelEnds ? day(cancelEnds) : null })}
          </p>
          <div className="mt-4"><PortalButton label="Keep my subscription" /></div>
        </>
      )}
      {/* Fallback only: the page already reconciled with Stripe on return; this covers a failed reconcile. */}
      {fromPortal && <p className="mt-3 text-[13px] text-muted">Just changed something in Stripe? It can take a minute to show up here.</p>}
    </section>
  );
}
