"use client";

// Mounts Stripe Embedded Checkout (#118). On completion, confirms server-side
// (writes trialing + trial end) and continues the flow. All failure paths show
// a friendly retry — never a blank box at the exact moment trust matters most.
import { useEffect, useRef, useState } from "react";
import { loadStripe, type StripeEmbeddedCheckout } from "@stripe/stripe-js";

export function CheckoutEmbed({ publishableKey }: { publishableKey: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let checkout: StripeEmbeddedCheckout | null = null;

    async function boot() {
      setError(null);
      if (!publishableKey) {
        setError("Payments aren't configured yet. Please try again later.");
        return;
      }
      try {
        const res = await fetch("/api/billing/checkout-session", { method: "POST" });
        const body = await res.json().catch(() => ({}));
        if (res.status === 409 && body.next) {
          window.location.href = body.next; // already subscribed — nothing to pay
          return;
        }
        if (!res.ok || !body.clientSecret) throw new Error(body.error ?? "no session");
        const stripe = await loadStripe(publishableKey);
        if (!stripe || cancelled) return;
        checkout = await stripe.initEmbeddedCheckout({
          clientSecret: body.clientSecret,
          onComplete: async () => {
            setConfirming(true);
            const c = await fetch(`/api/billing/confirm?session_id=${encodeURIComponent(body.sessionId)}`).then((r) => r.json()).catch(() => null);
            window.location.href = c?.next ?? "/dashboard?welcome=1";
          },
        });
        if (cancelled) { checkout.destroy(); return; }
        if (mountRef.current) checkout.mount(mountRef.current);
      } catch {
        if (!cancelled) setError("Couldn't load the payment form. Check your connection and retry.");
      }
    }
    boot();
    return () => { cancelled = true; checkout?.destroy(); };
  }, [publishableKey, attempt]);

  if (confirming) {
    return <p className="p-8 text-center text-[15px] text-muted">Setting up your trial…</p>;
  }
  if (error) {
    return (
      <div className="p-8 text-center">
        <p className="text-[15px] text-muted">{error}</p>
        <button type="button" onClick={() => setAttempt((a) => a + 1)} className="mt-3 rounded-full border border-line px-4 py-1.5 text-[14px] font-medium text-ink transition hover:border-accent">
          Retry
        </button>
      </div>
    );
  }
  return <div ref={mountRef} className="min-h-[420px]" />;
}
