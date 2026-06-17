import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ForgotPasswordForm } from "@/components/ForgotPasswordForm";
import { BrandMark } from "@/components/BrandMark";

export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  return (
    <main className="auth-bg flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <BrandMark />
        </div>
        <ForgotPasswordForm />
        <p className="mt-6 text-center text-sm text-muted">
          <Link href="/login" className="font-medium text-accent hover:text-accent-hover">
            ← Back to log in
          </Link>
        </p>
      </div>
    </main>
  );
}
