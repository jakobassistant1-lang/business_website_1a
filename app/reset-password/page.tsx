import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ResetPasswordForm } from "@/components/ResetPasswordForm";
import { BrandMark } from "@/components/BrandMark";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const user = await getCurrentUser();
  if (user) redirect("/");
  const { token } = await searchParams;

  return (
    <main className="auth-bg flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <BrandMark />
        </div>
        {token ? (
          <ResetPasswordForm token={token} />
        ) : (
          <div className="card p-6 text-center">
            <h1 className="text-xl font-semibold tracking-tight">Invalid reset link</h1>
            <p className="mt-2 text-sm text-muted">
              This link is missing its token. Request a new one and try again.
            </p>
            <p className="mt-4">
              <Link href="/forgot-password" className="font-medium text-accent hover:text-accent-hover">
                Request a new link
              </Link>
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
