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
export const metadata: Metadata = { title: "Log in to Navo" };

// Messages for a Google sign-in that bounced back here (see /api/auth/google/callback).
const GOOGLE_NOTICES: Record<string, string> = {
  google: "Logging in with Google didn’t finish. Try again.",
  google_unverified: "That Google account’s email isn’t verified, so Navo can’t log you in with it.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await getCurrentUser();
  if (user) redirect("/");
  const { error } = await searchParams;
  // The login door can switch to signup in place, so it carries the same terms (#110).
  const trialTerms = await loadTrialTerms();

  return (
    <main className="auth-bg flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <BrandMark />
        </div>
        <AuthFlow
          initialMode="login"
          inviteConfigured={isSignupOpen()}
          googleEnabled={isGoogleAuthConfigured()}
          notice={error ? GOOGLE_NOTICES[error] : undefined}
          trialTerms={trialTerms}
        />
      </div>
    </main>
  );
}
