"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ThemeToggle } from "./ThemeToggle";

const NAV = [
  { href: "/", label: "Plan", icon: "M4 6h16M4 12h16M4 18h10" },
  { href: "/connections", label: "Connections", icon: "M8 7a4 4 0 1 1 8 0M5 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2" },
  { href: "/settings", label: "Settings", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7-3a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1l-.4-2.5H9.6L9.2 5a7 7 0 0 0-1.7 1l-2.4-1-2 3.4L5 10a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 2.5h4.8l.4-2.5a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6c.06-.32.1-.65.1-1Z" },
  { href: "/account", label: "Account", icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0" },
];

// Kanban / board glyph for the admin section.
const BOARD_ICON = "M4 5h16v14H4zM9 5v14M15 5v14";
const AI_ICON = "M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4L12 3Z";

export function Sidebar({
  userName,
  userEmail,
  isAdmin = false,
}: {
  userName: string;
  userEmail: string;
  isAdmin?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  function linkClass(active: boolean) {
    return `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
      active
        ? "bg-accent text-accent-on"
        : "text-gray-300 hover:bg-gray-800 hover:text-white"
    }`;
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col bg-sidebar px-4 py-6">
      <Link href="/" className="mb-2 flex items-center gap-3 px-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-accent-on shadow-md">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M5 4h9l5 5v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M9 12.5l2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="text-lg font-bold tracking-tight text-white">StudyPlan</span>
      </Link>

      <nav className="mt-6 flex flex-col gap-1">
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className={linkClass(active)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d={item.icon} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {item.label}
            </Link>
          );
        })}

        {isAdmin && (
          <>
            <span className="px-3 pb-1 pt-5 text-xs font-semibold uppercase tracking-wider text-gray-500">
              Admin
            </span>
            <Link href="/admin" className={linkClass(pathname === "/admin")}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d={BOARD_ICON} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Board
            </Link>
            <Link href="/admin/ai" className={linkClass(pathname.startsWith("/admin/ai"))}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d={AI_ICON} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              AI settings
            </Link>
          </>
        )}
      </nav>

      <div className="mt-auto border-t border-gray-800 pt-4">
        <div className="px-2">
          <p className="truncate text-sm font-medium text-white">{userName}</p>
          <p className="truncate text-xs text-gray-400">{userEmail}</p>
        </div>
        <div className="mt-3 flex flex-col gap-1">
          <ThemeToggle className="w-full rounded-md px-3 py-2 text-left text-sm font-medium text-gray-300 transition-colors hover:bg-gray-800 hover:text-white" />
          <button
            onClick={logout}
            className="w-full rounded-md px-3 py-2 text-left text-sm font-medium text-gray-300 transition-colors hover:bg-gray-800 hover:text-white"
          >
            Log out
          </button>
        </div>
      </div>
    </aside>
  );
}
