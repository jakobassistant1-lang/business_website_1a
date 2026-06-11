import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isSignupOpen } from "@/lib/signup";
import { AuthFlow } from "@/components/AuthFlow";
import { BrandMark } from "@/components/BrandMark";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  return (
    <main className="auth-bg flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <BrandMark />
        </div>
        <AuthFlow initialMode="login" inviteConfigured={isSignupOpen()} />
      </div>
    </main>
  );
}
