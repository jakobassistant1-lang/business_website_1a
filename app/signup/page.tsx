import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isSignupOpen } from "@/lib/signup";
import { isGoogleAuthConfigured } from "@/lib/googleAuth";
import { AuthFlow } from "@/components/AuthFlow";
import { BrandMark } from "@/components/BrandMark";
import { loadTrialTerms } from "@/lib/trialTerms";

export const dynamic = "force-dynamic";

// Students land straight on the form; the h1 lives in AuthFlow (it follows the
// in-place login/signup switch). The admin door is the unlinked /admin/login.
export const metadata: Metadata = { title: "Create your Navo account" };

export default async function SignupPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");
  // Honest trial terms above the form (#110) — null while billing is off.
  const trialTerms = await loadTrialTerms();

  return (
    <main className="auth-bg flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <BrandMark />
        </div>
        <AuthFlow initialMode="signup" inviteConfigured={isSignupOpen()} googleEnabled={isGoogleAuthConfigured()} trialTerms={trialTerms} />
      </div>
    </main>
  );
}
