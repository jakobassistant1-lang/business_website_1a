import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin";
import { billingEnabled, needsCheckout } from "@/lib/subscription";
import { prisma } from "@/lib/prisma";
import { Sidebar } from "@/components/Sidebar";
import { ConnectionAlert } from "@/components/ConnectionAlert";

// FR-2.4: any app route requires auth.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Card-step resume (#118): a demo-finished student who never completed the
  // card step can't wander into the app — back to /welcome/card. (Admins and
  // grandfathered/subscribed accounts pass; full per-request gating is #119.)
  if (billingEnabled() && !isAdminUser(user) && user.onboardedAt && needsCheckout(user.subscriptionStatus)) {
    redirect("/welcome/card");
  }

  // Connection health (#65): one cheap indexed lookup so an expired/invalid Canvas
  // token is flagged app-wide with a one-step reconnect, on whatever page they're on.
  const cred = await prisma.canvasCredential.findUnique({
    where: { userId: user.id },
    select: { lastValidationStatus: true },
  });

  return (
    <div className="flex min-h-screen">
      <Sidebar userName={user.fullName} userEmail={user.email} isAdmin={isAdminUser(user)} />
      <main className="min-w-0 flex-1 px-6 py-8 lg:px-10 lg:py-10">
        <ConnectionAlert status={cred?.lastValidationStatus ?? null} />
        {children}
      </main>
    </div>
  );
}
