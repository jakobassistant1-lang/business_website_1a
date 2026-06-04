"use client";

const KEY = "flowboard-theme";

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
