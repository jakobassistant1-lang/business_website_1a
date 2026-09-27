"use client";

import { useEffect } from "react";
import { parseThemeCookie, themeCookieString, THEME_HEX, THEME_KEY, type Theme } from "@/lib/theme";

/** Point every <meta name="theme-color"> at the ACTIVE data-theme, so the
 *  browser chrome follows the user's choice rather than the OS scheme the
 *  metadata default is keyed on. Safe to call before the metas exist (no-op). */
export function syncThemeColorMeta() {
  const theme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    m.setAttribute("content", THEME_HEX[theme]);
  });
}

/** Persist the choice in BOTH stores: the cookie (read by the server and the
 *  pre-paint bootstrap — survives blocked storage) and the legacy localStorage
 *  key. Each write is best-effort; one failing never blocks the other. */
function persistTheme(theme: Theme) {
  try {
    document.cookie = themeCookieString(theme, location.protocol === "https:");
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}

/**
 * Light/dark toggle. Stateless: the current theme lives entirely on the
 * <html data-theme> attribute (server-rendered from the navo_theme cookie and
 * re-set pre-paint by the bootstrap script in app/layout.tsx). The label is
 * driven purely by CSS via the `dark:` variant — which is wired to
 * [data-theme="dark"] in tailwind.config.ts — so there's no first-paint flash
 * of the wrong label for dark-mode users. Clicking reads the attribute, flips
 * it, and persists the choice (cookie + localStorage).
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  // Once on mount: if the cookie and the attribute disagree (e.g. a cached or
  // stale server render), the cookie — the latest persisted choice — wins.
  useEffect(() => {
    const cookieTheme = parseThemeCookie(document.cookie);
    if (cookieTheme && document.documentElement.getAttribute("data-theme") !== cookieTheme) {
      document.documentElement.setAttribute("data-theme", cookieTheme);
      syncThemeColorMeta();
    }
  }, []);

  function toggle() {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    const next: Theme = isDark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    syncThemeColorMeta();
    persistTheme(next);
  }

  return (
    <button type="button" onClick={toggle} className={className} aria-label="Toggle color theme">
      <span className="dark:hidden">🌙 Dark</span>
      <span className="hidden dark:inline">☀ Light</span>
    </button>
  );
}
