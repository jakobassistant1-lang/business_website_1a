import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin";
import { accessDecision, billingEnabled, DECISION_PATH, isTrialing } from "@/lib/subscription";
import { prisma } from "@/lib/prisma";
import { Sidebar } from "@/components/Sidebar";
import { MobileTopBar } from "@/components/MobileTopBar";
import { MobileTabBar } from "@/components/MobileTabBar";
import { ConnectionAlert } from "@/components/ConnectionAlert";
import { TrialBanner } from "@/components/TrialBanner";
import { CancelScheduledNote } from "@/components/CancelScheduledNote";

// FR-2.4: any app route requires auth.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Per-request access gate (#119): decided from User.subscriptionStatus on
  // every request (sessions never expire server-side), through the ONE rule in
  // lib/subscription. Admins/grandfathered/trialing/active pass; everyone else
  // goes to exactly one destination (demo, card, past-due, canceled).
  const decision = accessDecision(user, billingEnabled(), isAdminUser(user));
  if (decision !== "allow") redirect(DECISION_PATH[decision]);

  // Connection health (#65): one cheap indexed lookup so an expired/invalid Canvas
  // token is flagged app-wide with a one-step reconnect, on whatever page they're on.
  const cred = await prisma.canvasCredential.findUnique({
    where: { userId: user.id },
    select: { lastValidationStatus: true },
  });

  // Shell (#39): phones (< md) get a top bar + bottom tab bar and no sidebar;
  // tablets/desktops (md+) get the sidebar (rail at md–lg). <main> reserves
  // room for the fixed tab bar + home-indicator inset on phones only.
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <Sidebar userName={user.fullName} userEmail={user.email} isAdmin={isAdminUser(user)} />
      <MobileTopBar userName={user.fullName} userEmail={user.email} isAdmin={isAdminUser(user)} />
      <main className="min-w-0 flex-1 overflow-x-hidden px-4 py-5 pb-[calc(56px+env(safe-area-inset-bottom)+1rem)] md:px-6 md:py-8 md:pb-8 lg:px-10 lg:py-10 lg:pb-10">
        <ConnectionAlert status={cred?.lastValidationStatus ?? null} />
        <TrialBanner user={user} isAdmin={isAdminUser(user)} />
        <CancelScheduledNote enabled={billingEnabled()} trialing={isTrialing(user.subscriptionStatus)} cancelAtPeriodEnd={user.cancelAtPeriodEnd} currentPeriodEnd={user.currentPeriodEnd} />
        {children}
      </main>
      <MobileTabBar />
    </div>
  );
}
