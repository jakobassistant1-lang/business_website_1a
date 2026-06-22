"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ThemeToggle } from "./ThemeToggle";

// Daily-use surfaces live in the main nav; setup screens (Connections / Settings /
// Account) live in the account menu at the bottom, so they don't compete with home.
const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "M4 13h7V4H4v9Zm0 7h7v-5H4v5Zm9 0h7v-9h-7v9Zm0-16v5h7V4h-7Z" },
  { href: "/plan", label: "Plan", icon: "M8 6h12M8 12h12M8 18h12M3.5 6h.01M3.5 12h.01M3.5 18h.01" },
  { href: "/study", label: "Study", icon: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15ZM4 19.5A2.5 2.5 0 0 0 6.5 22H20M8 7h8" },
  { href: "/courses", label: "Courses", icon: "M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v4H4zM14 15h6v4h-6z" },
];

const SETUP = [
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
const CHEV_D = "M6 9l6 6 6-6";
const LOGOUT_ICON = "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9";

function Icon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d={d} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function initials(name: string) {
  const p = name.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function Sidebar({ userName, userEmail, isAdmin = false }: { userName: string; userEmail: string; isAdmin?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("sp_sidebar_collapsed") === "1");
    } catch {
      /* ignore */
    }
  }, []);

  // Close the account menu on an outside click or a route change.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);
  useEffect(() => setMenuOpen(false), [pathname]);

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

  const menuItemClass = "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700 hover:text-white";

  return (
    <aside className={`flex shrink-0 flex-col bg-sidebar py-6 transition-[width] duration-150 ${collapsed ? "w-16 px-2" : "w-64 px-4"}`}>
      <div className={`mb-2 flex items-center px-1 ${collapsed ? "justify-center" : "justify-between"}`}>
        <Link href="/dashboard" className="flex items-center gap-3" title="Navo">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-accent-on shadow-md">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M5 4h9l5 5v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="M9 12.5l2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          {!collapsed && <span className="text-lg font-bold tracking-tight text-white">Navo</span>}
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
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} className={linkClass(pathname.startsWith(item.href))} title={item.label}>
            <Icon d={item.icon} />
            {!collapsed && item.label}
          </Link>
        ))}

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

      {/* Account menu — setup screens + theme + logout, tucked under the avatar. */}
      <div className="relative mt-auto border-t border-gray-800 pt-3" ref={menuRef}>
        {menuOpen && (
          <div className={`absolute bottom-full mb-2 rounded-lg border border-gray-700 bg-gray-800 p-1.5 shadow-xl ${collapsed ? "left-0 w-56" : "left-0 right-0"}`}>
            {SETUP.map((item) => (
              <Link key={item.href} href={item.href} className={menuItemClass}>
                <Icon d={item.icon} />
                {item.label}
              </Link>
            ))}
            <Link href="/demo" className={menuItemClass}>
              <Icon d="M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5" />
              Replay walkthrough
            </Link>
            <div className="my-1 border-t border-gray-700" />
            <ThemeToggle className={menuItemClass} />
            <button onClick={logout} className={menuItemClass}>
              <Icon d={LOGOUT_ICON} />
              Log out
            </button>
          </div>
        )}
        <button
          onClick={() => setMenuOpen((o) => !o)}
          title="Account menu"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className={`flex w-full items-center gap-3 rounded-md py-2 text-left transition-colors hover:bg-gray-800 ${collapsed ? "justify-center px-1" : "px-2"}`}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-[12px] font-semibold text-accent-on">{initials(userName)}</span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-white">{userName}</span>
                <span className="block truncate text-xs text-gray-400">{userEmail}</span>
              </span>
              <span className="shrink-0 text-gray-400">
                <Icon d={CHEV_D} size={16} />
              </span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
