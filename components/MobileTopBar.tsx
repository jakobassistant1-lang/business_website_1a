"use client";

// Phone shell (ticket #39): a slim sticky header below `md` — brand mark, the
// current page's title (pure `pageTitle` from the pathname) and a round
// account button that opens the AccountSheet. Nothing here is the primary
// navigation; the thumb-zone tab bar owns that.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccountSheet } from "./AccountSheet";
import { BrandMark } from "./BrandMark";
import { syncThemeColorMeta } from "./ThemeToggle";
import { initialsOf, pageTitle } from "./navItems";

export function MobileTopBar({ userName, userEmail, isAdmin }: { userName: string; userEmail: string; isAdmin: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // A route change (a sheet row navigated) closes the sheet.
  useEffect(() => setOpen(false), [pathname]);
  // This bar is mounted on every app page (hidden at md+ but present), so it is
  // the one always-on place to align the browser-chrome color with a stored
  // theme choice on load; the toggle keeps it aligned afterwards.
  useEffect(() => syncThemeColorMeta(), []);

  return (
    <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-line bg-surface/95 px-3 backdrop-blur md:hidden">
      <Link href="/dashboard" className="tap flex items-center" aria-label="Navo home">
        <BrandMark compact />
      </Link>
      {/* Decorative: each page keeps its own top heading; this is NOT a second h1. */}
      <p aria-hidden="true" className="min-w-0 truncate text-sm font-semibold text-ink">
        {pageTitle(pathname)}
      </p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Account menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="tap flex items-center justify-end"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-[12px] font-semibold text-accent-on">{initialsOf(userName)}</span>
      </button>
      <AccountSheet open={open} onClose={() => setOpen(false)} userName={userName} userEmail={userEmail} isAdmin={isAdmin} />
    </header>
  );
}
