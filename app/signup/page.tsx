import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isSignupOpen } from "@/lib/signup";
import { SignupForm } from "@/components/SignupForm";
import { BrandMark } from "@/components/BrandMark";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  const open = isSignupOpen();

  return (
    <main className="auth-bg flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">
            {open ? "Create your account" : "Invite only"}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {open ? "Enter your invite code to get started." : "Signups are currently invite-only."}
          </p>
        </div>
        <div className="card p-6">
          {open ? (
            <SignupForm />
          ) : (
            <p className="text-sm text-muted">
              This app doesn&apos;t have open registration. Ask an admin for an invite or to create
              an account for you.
            </p>
          )}
        </div>
        <p className="mt-6 text-center text-sm text-muted">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-accent hover:text-accent-hover">
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}
