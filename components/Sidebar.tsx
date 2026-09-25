"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ThemeToggle } from "./ThemeToggle";
import { NavIcon } from "./NavIcon";
import { adminItems, initialsOf, navItems, setupItems } from "./navItems";

// Daily-use surfaces live in the main nav; setup screens (Connections / Settings /
// Account) live in the account menu at the bottom, so they don't compete with home.
// The item lists are shared with the phone shell (components/navItems.ts).
//
// Widths (ticket #39): below `md` the sidebar is not rendered at all — the phone
// tab bar replaces it. At `md`–`lg` (tablets) it is ALWAYS the 64px icon rail
// with native-title tooltips and no collapse chevrons, done in CSS (`lg:`
// variants) so there is no post-hydration snap. At `lg+` the stored collapse
// preference is honored exactly as before.

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

  // "Wide-only" = shown when the sidebar is expanded, which can only happen at lg+.
  const wideOnly = collapsed ? "hidden" : "hidden lg:inline";
  const wideOnlyFlex = collapsed ? "hidden" : "hidden lg:flex";
  const wideOnlyBlock = collapsed ? "hidden" : "hidden lg:block";

  function linkClass(active: boolean) {
    return `flex items-center gap-3 rounded-md py-2 text-sm font-medium transition-colors ${
      collapsed ? "justify-center px-2" : "justify-center px-2 lg:justify-start lg:px-3"
    } ${active ? "bg-accent text-accent-on" : "text-gray-300 hover:bg-gray-800 hover:text-white"}`;
  }

  const menuItemClass = "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700 hover:text-white";

  return (
    <aside
      className={`sticky top-0 hidden h-dvh shrink-0 flex-col bg-sidebar py-6 transition-[width] duration-150 md:flex ${
        collapsed ? "w-16 px-2" : "w-16 px-2 lg:w-64 lg:px-4"
      }`}
    >
      <div className={`mb-2 flex items-center px-1 ${collapsed ? "justify-center" : "justify-center lg:justify-between"}`}>
        <Link href="/dashboard" className="flex items-center gap-3" title="Navo">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-accent-on shadow-md">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M5 4h9l5 5v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="M9 12.5l2 2 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className={`${wideOnly} text-lg font-bold tracking-tight text-white`}>Navo</span>
        </Link>
        {!collapsed && (
          <button onClick={toggleCollapse} title="Collapse menu" aria-label="Collapse menu" className="hidden text-gray-400 transition-colors hover:text-white lg:block">
            <NavIcon name="chevronLeft" size={18} />
          </button>
        )}
      </div>
      {collapsed && (
        <button onClick={toggleCollapse} title="Expand menu" aria-label="Expand menu" className="mx-auto mb-2 hidden text-gray-400 transition-colors hover:text-white lg:block">
          <NavIcon name="chevronRight" size={18} />
        </button>
      )}

      {/* The nav scrolls internally on short viewports; the account block below
          stays pinned to the bottom of the SCREEN (the aside is viewport-height
          and sticky — it no longer stretches to page height or rides the scroll). */}
      <nav className="mt-4 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {navItems.map((item) => (
          <Link key={item.href} href={item.href} className={linkClass(pathname.startsWith(item.href))} title={item.label}>
            <NavIcon name={item.icon} />
            <span className={wideOnly}>{item.label}</span>
          </Link>
        ))}

        {isAdmin && (
          <>
            <div className={`my-1 border-t border-gray-800 ${collapsed ? "" : "lg:hidden"}`} />
            <span className={`${wideOnlyBlock} px-3 pb-1 pt-5 text-xs font-semibold uppercase tracking-wider text-gray-500`}>Admin</span>
            {adminItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={linkClass(item.exact ? pathname === item.href : pathname.startsWith(item.href))}
                title={item.label}
              >
                <NavIcon name={item.icon} />
                <span className={wideOnly}>{item.label}</span>
              </Link>
            ))}
          </>
        )}
      </nav>

      {/* Account menu — setup screens + theme + logout, tucked under the avatar. */}
      <div className="relative mt-auto border-t border-gray-800 pt-3" ref={menuRef}>
        {menuOpen && (
          <div className={`absolute bottom-full left-0 mb-2 rounded-lg border border-gray-700 bg-gray-800 p-1.5 shadow-xl ${collapsed ? "w-56" : "w-56 lg:right-0 lg:w-auto"}`}>
            {setupItems.map((item) => (
              <Link key={item.href} href={item.href} className={menuItemClass}>
                <NavIcon name={item.icon} />
                {item.label}
              </Link>
            ))}
            <Link href="/demo" className={menuItemClass}>
              <NavIcon name="replay" />
              Replay walkthrough
            </Link>
            <div className="my-1 border-t border-gray-700" />
            <ThemeToggle className={menuItemClass} />
            <button onClick={logout} className={menuItemClass}>
              <NavIcon name="logout" />
              Log out
            </button>
          </div>
        )}
        <button
          onClick={() => setMenuOpen((o) => !o)}
          title="Account menu"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className={`flex w-full items-center gap-3 rounded-md py-2 text-left transition-colors hover:bg-gray-800 ${
            collapsed ? "justify-center px-1" : "justify-center px-1 lg:justify-start lg:px-2"
          }`}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-[12px] font-semibold text-accent-on">{initialsOf(userName)}</span>
          <span className={`${wideOnlyBlock} min-w-0 flex-1`}>
            <span className="block truncate text-sm font-medium text-white">{userName}</span>
            <span className="block truncate text-xs text-gray-400">{userEmail}</span>
          </span>
          <span className={`${wideOnlyFlex} shrink-0 text-gray-400`}>
            <NavIcon name="chevronDown" size={16} />
          </span>
        </button>
      </div>
    </aside>
  );
}
