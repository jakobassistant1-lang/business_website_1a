import { redirect } from "next/navigation";
import { requirePageAccess } from "@/lib/access";

// First-run students (onboardedAt null) get the demo walkthrough; everyone else
// lands on the calm Dashboard. Calendar + Timeline live inside /plan now.
export default async function HomePage() {
  const user = await requirePageAccess(); // #119 gate, re-run per page (see lib/access)
  if (!user.onboardedAt) redirect("/demo");
  redirect("/dashboard");
}
