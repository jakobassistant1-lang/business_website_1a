import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isSignupOpen } from "@/lib/signup";
import { AuthFlow } from "@/components/AuthFlow";
import { BrandMark } from "@/components/BrandMark";

export const dynamic = "force-dynamic";

// The admin door (#139). Deliberately unlinked from every page: students get the
// plain /login and /signup forms, admins bookmark this. Admin signup still needs
// the invite code once; after that the account is remembered as admin and login
// lands on /admin (the login route returns isAdmin).
export const metadata: Metadata = { title: "Log in as an admin", robots: { index: false, follow: false } };

export default async function AdminLoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  return (
    <main className="auth-bg flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <BrandMark />
        </div>
        <AuthFlow role="admin" initialMode="login" inviteConfigured={isSignupOpen()} googleEnabled={false} />
      </div>
    </main>
  );
}
