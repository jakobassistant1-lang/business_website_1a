"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ThemeToggle } from "./ThemeToggle";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "M4 13h7V4H4v9Zm0 7h7v-5H4v5Zm9 0h7v-9h-7v9Zm0-16v5h7V4h-7Z" },
  { href: "/calendar", label: "Calendar", icon: "M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" },
  { href: "/timeline", label: "Timeline", icon: "M3 4v16M4 7h9M4 12h13M4 17h6" },
  { href: "/connections", label: "Connections", icon: "M8 7a4 4 0 1 1 8 0M5 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2" },
  { href: "/settings", label: "Settings", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7-3a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1l-.4-2.5H9.6L9.2 5a7 7 0 0 0-1.7 1l-2.4-1-2 3.4L5 10a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 2.5h4.8l.4-2.5a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6c.06-.32.1-.65.1-1Z" },
  { href: "/account", label: "Account", icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0" },
];

const BOARD_ICON = "M4 5h16v14H4zM9 5v14M15 5v14";
const MARKETING_ICON = "M4 9v6h3l5 4V5L7 9H4Z M16 9a3 3 0 0 1 0 6";
const AI_ICON = "M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4L12 3Z";
const HIERARCHY_ICON = "M10 3h4v4h-4zM3 17h4v4H3zM17 17h4v4h-4zM12 7v4M5 17v-2h14v2";
const BURNDOWN_ICON = "M4 4v16h16M7 8l10 9";
const CHEV_L = "M15 6l-6 6 6 6";
const CHEV_R = "M9 6l6 6-6 6";
const LOGOUT_ICON = "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9";

function Icon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d={d} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Sidebar({ userName, userEmail, isAdmin = false }: { userName: string; userEmail: string; isAdmin?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("sp_sidebar_collapsed") === "1");
    } catch {
      /* ignore */
    }
  }, []);

  function toggleCollapse() {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("sp_sidebar_collapsed", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  function linkClass(active: boolean) {
    return `flex items-center gap-3 rounded-md py-2 text-sm font-medium transition-colors ${
      collapsed ? "justify-center px-2" : "px-3"
    } ${active ? "bg-accent text-accent-on" : "text-gray-300 hover:bg-gray-800 hover:text-white"}`;
  }

  return (
    <aside className={`flex shrink-0 flex-col bg-sidebar py-6 transition-[width] duration-150 ${collapsed ? "w-16 px-2" : "w-64 px-4"}`}>
      <div className={`mb-2 flex items-center px-1 ${collapsed ? "justify-center" : "justify-between"}`}>
        <Link href="/dashboard" className="flex items-center gap-3" title="StudyPlan">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-accent-on shadow-md">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M5 4h9l5 5v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="M9 12.5l2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          {!collapsed && <span className="text-lg font-bold tracking-tight text-white">StudyPlan</span>}
        </Link>
        {!collapsed && (
          <button onClick={toggleCollapse} title="Collapse menu" aria-label="Collapse menu" className="text-gray-400 transition-colors hover:text-white">
            <Icon d={CHEV_L} size={18} />
          </button>
        )}
      </div>
      {collapsed && (
        <button onClick={toggleCollapse} title="Expand menu" aria-label="Expand menu" className="mx-auto mb-2 text-gray-400 transition-colors hover:text-white">
          <Icon d={CHEV_R} size={18} />
        </button>
      )}

      <nav className="mt-4 flex flex-col gap-1">
        {NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className={linkClass(active)} title={item.label}>
              <Icon d={item.icon} />
              {!collapsed && item.label}
            </Link>
          );
        })}

        {isAdmin && (
          <>
            {collapsed ? (
              <div className="my-1 border-t border-gray-800" />
            ) : (
              <span className="px-3 pb-1 pt-5 text-xs font-semibold uppercase tracking-wider text-gray-500">Admin</span>
            )}
            <Link href="/admin" className={linkClass(pathname === "/admin")} title="Board">
              <Icon d={BOARD_ICON} />
              {!collapsed && "Board"}
            </Link>
            <Link href="/admin/marketing" className={linkClass(pathname.startsWith("/admin/marketing"))} title="Marketing board">
              <Icon d={MARKETING_ICON} />
              {!collapsed && "Marketing"}
            </Link>
            <Link href="/admin/hierarchy" className={linkClass(pathname.startsWith("/admin/hierarchy"))} title="Hierarchy map">
              <Icon d={HIERARCHY_ICON} />
              {!collapsed && "Hierarchy"}
            </Link>
            <Link href="/admin/burndown" className={linkClass(pathname.startsWith("/admin/burndown"))} title="Burndown">
              <Icon d={BURNDOWN_ICON} />
              {!collapsed && "Burndown"}
            </Link>
            <Link href="/admin/ai" className={linkClass(pathname.startsWith("/admin/ai"))} title="AI settings">
              <Icon d={AI_ICON} />
              {!collapsed && "AI settings"}
            </Link>
          </>
        )}
      </nav>

      <div className="mt-auto border-t border-gray-800 pt-4">
        {!collapsed && (
          <div className="px-2">
            <p className="truncate text-sm font-medium text-white">{userName}</p>
            <p className="truncate text-xs text-gray-400">{userEmail}</p>
          </div>
        )}
        <div className={`mt-3 flex flex-col gap-1 ${collapsed ? "items-center" : ""}`}>
          {!collapsed && (
            <ThemeToggle className="w-full rounded-md px-3 py-2 text-left text-sm font-medium text-gray-300 transition-colors hover:bg-gray-800 hover:text-white" />
          )}
          <button
            onClick={logout}
            title="Log out"
            className={`rounded-md py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-800 hover:text-white ${
              collapsed ? "px-2" : "w-full px-3 text-left"
            }`}
          >
            {collapsed ? <Icon d={LOGOUT_ICON} /> : "Log out"}
          </button>
        </div>
      </div>
    </aside>
  );
}
