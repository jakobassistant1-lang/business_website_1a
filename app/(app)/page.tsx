import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

// First-run students (onboardedAt null) get the demo walkthrough; everyone else
// lands on the calm Dashboard. Calendar + Timeline live inside /plan now.
export default async function HomePage() {
  const user = await getCurrentUser();
  if (user && !user.onboardedAt) redirect("/demo");
  redirect("/dashboard");
}
