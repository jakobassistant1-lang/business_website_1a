"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatDateHuman } from "@/lib/calendarDates";
import { cancelScheduledText } from "@/lib/subscription";

/** One muted line under the app's alerts (#109) while a cancel is scheduled on
 *  a PAID plan: the student keeps full access until the period ends and can
 *  change their mind on /account ("Keep my subscription"). Not shown while trialing
 *  (TrialBanner already owns that space), not on /account itself (the billing
 *  card says it), and never while BILLING_ENABLED is unset (`enabled` is decided
 *  server-side by the layout — this client component holds no billing logic). */
export function CancelScheduledNote({
  enabled,
  trialing,
  cancelAtPeriodEnd,
  currentPeriodEnd,
}: {
  enabled: boolean;
  trialing: boolean;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
}) {
  const pathname = usePathname();
  if (!enabled || trialing || !cancelAtPeriodEnd || !currentPeriodEnd || pathname === "/account") return null;
  return (
    <p className="mb-6 text-[13px] text-muted">
      {cancelScheduledText({ trialing, endsOn: formatDateHuman(currentPeriodEnd) })} Changed your mind?{" "}
      <Link href="/account" className="font-medium text-accent hover:underline">
        Keep your subscription
      </Link>
      .
    </p>
  );
}
