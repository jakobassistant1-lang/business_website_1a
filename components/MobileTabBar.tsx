"use client";

// Phone shell (ticket #39): the fixed bottom tab bar that replaces the sidebar
// below `md`. Four always-labelled destinations — exactly the first four
// `navItems` (TAB_ITEMS), so they can't drift from the sidebar — each a ≥44px
// target, 56px tall plus the home-indicator safe area. Visible tabs beat a
// hamburger for discoverability (docs/mobile-ux-plan.md §2).

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavIcon } from "./NavIcon";
import { TAB_ITEMS, activeTabHref } from "./navItems";

export function MobileTabBar() {
  const pathname = usePathname();
  const active = activeTabHref(pathname);
  return (
    <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-safe md:hidden">
      <ul className="flex h-14">
        {TAB_ITEMS.map((item) => {
          const isActive = active === item.href;
          return (
            <li key={item.href} className="min-w-0 flex-1">
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`tap flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium leading-none transition-colors ${
                  isActive ? "text-accent" : "text-muted"
                }`}
              >
                <NavIcon name={item.icon} size={22} />
                <span>{item.tabLabel}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
