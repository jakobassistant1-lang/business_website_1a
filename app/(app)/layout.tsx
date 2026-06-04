import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin";
import { Sidebar } from "@/components/Sidebar";

// FR-2.4: any app route requires auth.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <Sidebar userName={user.fullName} userEmail={user.email} isAdmin={isAdminUser(user)} />
      <main className="min-w-0 flex-1 px-6 py-8 lg:px-10 lg:py-10">{children}</main>
    </div>
  );
}
