"use client";

// Client-side actions for the past-due / canceled screens (#119). Kept tiny:
// the screens themselves are server components; only the buttons need JS.
import { useState } from "react";
import { useRouter } from "next/navigation";

/** "Update payment method" → POST /api/billing/portal → Stripe's hosted portal. */
export function UpdatePaymentButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        if (body.next) {
          window.location.href = body.next; // nothing to update here — back to the card step
          return;
        }
        // No subscription to fix and no card step to send them to — a human sorts it out.
        setError("We couldn't find an active subscription for this account — email support@navolearning.com and we'll sort it out.");
        setBusy(false);
        return;
      }
      if (!res.ok || !body.url) throw new Error(body.error ?? "no url");
      window.location.href = body.url;
    } catch (e) {
      setError(e instanceof Error && e.message !== "no url" ? e.message : "Couldn't open the payment page. Try again in a moment.");
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={open} disabled={busy} className="btn-primary">
        {busy ? "Opening…" : "Update payment method"}
      </button>
      {error && <p className="mt-3 text-[14px] text-danger">{error}</p>}
    </div>
  );
}

/** Same mechanism as the Sidebar's account menu: POST logout, then to /login. */
export function SignOutLink() {
  const router = useRouter();
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }
  return (
    <button type="button" onClick={logout} className="font-medium text-muted hover:text-ink hover:underline">
      Sign out
    </button>
  );
}
