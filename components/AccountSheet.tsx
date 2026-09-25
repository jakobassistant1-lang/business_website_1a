"use client";

// Phone shell (ticket #39): everything the desktop sidebar tucks under the
// avatar — setup screens, admin, the walkthrough replay, theme, log out — as
// 48px rows in a bottom sheet, one tap from the top bar's account button.
// The actions are the SAME ones the Sidebar's account menu performs.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { NavIcon } from "./NavIcon";
import { Sheet } from "./Sheet";
import { ThemeToggle } from "./ThemeToggle";
import { adminItems, setupItems } from "./navItems";

const ROW = "tap flex h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-ink transition-colors hover:bg-surface-soft";

export function AccountSheet({
  open,
  onClose,
  userName,
  userEmail,
  isAdmin,
}: {
  open: boolean;
  onClose: () => void;
  userName: string;
  userEmail: string;
  isAdmin: boolean;
}) {
  const router = useRouter();

  // Same mechanism as the Sidebar's account menu: POST logout, then to /login.
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <Sheet open={open} onClose={onClose} title={userName}>
      <p className="-mt-1 mb-3 truncate text-xs text-muted">{userEmail}</p>
      <div className="flex flex-col">
        {setupItems.map((item) => (
          <Link key={item.href} href={item.href} className={ROW} onClick={onClose}>
            <NavIcon name={item.icon} />
            {item.label}
          </Link>
        ))}
        {isAdmin && (
          <Link href={adminItems[0].href} className={ROW} onClick={onClose}>
            <NavIcon name={adminItems[0].icon} />
            Admin
          </Link>
        )}
        <Link href="/demo" className={ROW} onClick={onClose}>
          <NavIcon name="replay" />
          Replay walkthrough
        </Link>
        <div className="my-1 border-t border-line-subtle" />
        <ThemeToggle className={ROW} />
        <button type="button" onClick={logout} className={ROW}>
          <NavIcon name="logout" />
          Log out
        </button>
      </div>
    </Sheet>
  );
}
