import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin";
import { isBillingConfigured } from "@/lib/billing";
import { prisma } from "@/lib/prisma";

// Home routing. With billing OFF (today's default) this is exactly as before:
// straight to the calm Dashboard. With billing CONFIGURED it becomes "value-first" —
// a brand-new student who hasn't linked Canvas yet is sent to connect FIRST (their
// real plan, the aha, is gated behind that). Admins always go straight through.
export default async function HomePage() {
  if (isBillingConfigured()) {
    const user = await getCurrentUser(); // the (app) layout already guaranteed auth
    if (user && !isAdminUser(user)) {
      const cred = await prisma.canvasCredential.findUnique({
        where: { userId: user.id },
        select: { id: true },
      });
      if (!cred) redirect("/connections");
    }
  }
  redirect("/dashboard");
}
