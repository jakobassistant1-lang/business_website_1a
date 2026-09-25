"use client";

const KEY = "flowboard-theme";

// Browser-chrome color per theme. These two hexes are the brand canvas (--bg,
// light) and ink (--bg, dark) tokens from app/globals.css — a <meta> can't read
// CSS variables, so this and the matching default in app/layout.tsx are the ONLY
// places raw hex is allowed. Keep in sync with the tokens.
const THEME_COLOR: Record<"light" | "dark", string> = { light: "#f7f6f4", dark: "#161619" };

/** Point every <meta name="theme-color"> at the ACTIVE data-theme, so the
 *  browser chrome follows the user's choice rather than the OS scheme the
 *  metadata default is keyed on. Safe to call before the metas exist (no-op). */
export function syncThemeColorMeta() {
  const theme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    m.setAttribute("content", THEME_COLOR[theme]);
  });
}

/**
 * Light/dark toggle. Stateless: the current theme lives entirely on the
 * <html data-theme> attribute (set pre-paint by the bootstrap script in
 * app/layout.tsx). The label is driven purely by CSS via the `dark:` variant —
 * which is wired to [data-theme="dark"] in tailwind.config.ts — so there's no
 * first-paint flash of the wrong label for dark-mode users. Clicking reads the
 * attribute and flips it.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  function toggle() {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    const next = isDark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    syncThemeColorMeta();
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* ignore */
    }
  }

  return (
    <button type="button" onClick={toggle} className={className} aria-label="Toggle color theme">
      <span className="dark:hidden">🌙 Dark</span>
      <span className="hidden dark:inline">☀ Light</span>
    </button>
  );
}
