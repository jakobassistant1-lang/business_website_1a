// Ticket #39 (M1): the phone/tablet shell and its global foundations. Pure
// tests for the pathname helpers the shell renders from, plus grep guards so
// the shell's wiring (layout, sidebar breakpoints, tab bar, Sheet, CSS,
// manifest, viewport) can't be quietly undone by a later task. Guards assert
// TOKEN PRESENCE (class names / identifiers split on whitespace and quotes),
// never whole class strings or attribute order, so a reflow of a className
// doesn't fail them.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { navItems, TAB_ITEMS, setupItems, pageTitle, activeTabHref, initialsOf } from "@/components/navItems";
import { NAV_ICONS } from "@/components/navIcons";

const read = (p: string) => readFileSync(p, "utf8");
/** Does `src` contain `word` as a whole token? Letters, digits, `_` and `-`
 *  are token characters; everything else (space, quote, `=`, `{`, `:`, `.`,
 *  `(`, …) is a boundary. Multi-part class names (`md:hidden`, `bg-ink/40`,
 *  `max-h-[85dvh]`, `#f7f6f4`) are matched as whole literals. Order-independent
 *  by construction — never pins a full className string. */
const hasToken = (src: string, word: string) => {
  const esc = word.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(`(^|[^\\w-])${esc}(?=$|[^\\w-])`, "m").test(src);
};
const expectTokens = (src: string, ...want: string[]) => {
  for (const w of want) expect(hasToken(src, w), `missing token ${w}`).toBe(true);
};

describe("pageTitle (phone top bar)", () => {
  it.each([
    ["/dashboard", "Today"],
    ["/plan", "Plan"],
    ["/study", "Study"],
    ["/study/123", "Study"],
    ["/courses", "Classes"],
    ["/class/9", "Class"],
    ["/assignment/42", "Assignment"],
    ["/connections", "Connections"],
    ["/settings", "Settings"],
    ["/account", "Account"],
    ["/admin", "Admin"],
    ["/admin/marketing", "Admin"],
  ])("%s → %s", (path, title) => {
    expect(pageTitle(path)).toBe(title);
  });
  it("unknown routes fall back to the product name", () => {
    expect(pageTitle("/")).toBe("Navo");
    expect(pageTitle("/something-else")).toBe("Navo");
  });
});

describe("activeTabHref (which tab lights up)", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/assignment/42", "/dashboard"], // assignment detail belongs to Today
    ["/plan", "/plan"],
    ["/study", "/study"],
    ["/study/7", "/study"],
    ["/courses", "/courses"],
    ["/class/3", "/courses"], // class page belongs to Classes
  ])("%s → %s", (path, href) => {
    expect(activeTabHref(path)).toBe(href);
  });
  it("setup and admin routes light no tab", () => {
    for (const p of ["/connections", "/settings", "/account", "/admin", "/admin/ai", "/"]) expect(activeTabHref(p)).toBeNull();
  });
  it("every active href is one of the four tabs", () => {
    const hrefs = new Set(TAB_ITEMS.map((t) => t.href));
    for (const p of ["/dashboard", "/assignment/1", "/plan", "/study/2", "/courses", "/class/3"]) expect(hrefs.has(activeTabHref(p)!)).toBe(true);
  });
});

describe("navItems — the ONE nav list", () => {
  it("the first four entries are the phone tab destinations, in order", () => {
    expect(navItems.slice(0, 4).map((i) => i.href)).toEqual(["/dashboard", "/plan", "/study", "/courses"]);
    expect(TAB_ITEMS.map((i) => i.href)).toEqual(navItems.slice(0, 4).map((i) => i.href));
    expect(TAB_ITEMS.map((i) => i.tabLabel)).toEqual(["Today", "Plan", "Study", "Classes"]);
  });
  it("every item's icon key exists in NAV_ICONS", () => {
    for (const i of [...navItems, ...setupItems]) expect(NAV_ICONS[i.icon]).toBeTypeOf("string");
  });
  it("initialsOf", () => {
    expect(initialsOf("Maya Chen")).toBe("MC");
    expect(initialsOf("  maya ")).toBe("M");
    expect(initialsOf("")).toBe("?");
  });
});

describe("grep guard: MobileTabBar renders TAB_ITEMS, never its own hrefs", () => {
  const src = read("components/MobileTabBar.tsx");
  it("imports TAB_ITEMS + activeTabHref from navItems and hardcodes no href", () => {
    expectTokens(src, "TAB_ITEMS", "activeTabHref");
    expect(/href="\//.test(src)).toBe(false);
  });
  it("is phone-only, fixed to the bottom, 56px + safe area, 44px targets, aria-current", () => {
    expectTokens(src, "md:hidden", "fixed", "inset-x-0", "bottom-0", "h-14", "pb-safe", "tap", "aria-current", "page", "text-accent", "text-muted");
  });
});

describe("grep guard: the (app) layout wires the phone shell and keeps the access gate", () => {
  const src = read("app/(app)/layout.tsx");
  it("renders the Sidebar, MobileTopBar and MobileTabBar", () => {
    expectTokens(src, "<Sidebar", "<MobileTopBar", "<MobileTabBar");
  });
  it("still gates through accessDecision / DECISION_PATH and keeps the three banners", () => {
    expect(src.includes("accessDecision(")).toBe(true);
    expect(src.includes("DECISION_PATH[")).toBe(true);
    expectTokens(src, "<ConnectionAlert", "<TrialBanner", "<CancelScheduledNote");
  });
  it("<main> guards horizontal overflow and reserves the tab-bar height on phones", () => {
    expectTokens(src, "overflow-x-hidden", "min-h-dvh", "flex-col", "md:flex-row");
    expect(src.includes("pb-[calc(56px+env(safe-area-inset-bottom)+1rem)]")).toBe(true);
  });
});

describe("grep guard: Sidebar breakpoints", () => {
  const src = read("components/Sidebar.tsx");
  it("is hidden below md, uses dvh (never 100vh), and pads the rail for a left cutout", () => {
    expectTokens(src, "hidden", "md:flex", "h-dvh");
    expect(hasToken(src, "h-screen")).toBe(false);
    expect(src.includes("env(safe-area-inset-left)")).toBe(true);
  });
  it("renders the shared navItems and icons (no private path strings)", () => {
    expectTokens(src, "navItems", "NavIcon");
    expect(/icon:\s*"M/.test(src)).toBe(false);
  });
  it("the collapse/expand chevrons exist and are lg-only (tablets are always the rail)", () => {
    expect(src.includes("Collapse menu")).toBe(true);
    expect(src.includes("Expand menu")).toBe(true);
    expectTokens(src, "lg:block", "lg:w-64", "lg:inline");
  });
});

describe("grep guard: Sheet and the phone account surfaces", () => {
  it("Sheet exports Sheet + useIsPhone, is a bottom sheet on phones and a dialog at md+", () => {
    const src = read("components/Sheet.tsx");
    expect(src.includes("export function Sheet(")).toBe(true);
    expect(src.includes("export function useIsPhone()")).toBe(true);
    expect(src.includes("(max-width: 767px)")).toBe(true);
    expectTokens(src, "max-h-[85dvh]", "rounded-t-2xl", "md:max-w-md", "md:rounded-2xl", "role=", "dialog", "aria-modal=", "aria-labelledby=", "bg-ink/40", "pb-safe");
  });
  it("Sheet locks <html> AND <body> scroll behind a counter, only the top sheet handles Escape, and the backdrop blocks touch scroll", () => {
    const src = read("components/Sheet.tsx");
    expect(src.includes("document.documentElement.style.overflow")).toBe(true);
    expect(src.includes("document.body.style.overflow")).toBe(true);
    expectTokens(src, "lockCount", "openSheets", "isTopSheet", "touch-none");
    expect(src.includes("stopPropagation")).toBe(false);
  });
  it("Sheet focuses the panel itself (not the Close button) and clamps long titles", () => {
    const src = read("components/Sheet.tsx");
    expect(src.includes("panel?.focus()")).toBe(true);
    expectTokens(src, "line-clamp-2");
    expect(/<h2[^>]*\btruncate\b/.test(src)).toBe(false);
  });
  it("AccountSheet uses Sheet with the sidebar's setup items, replay and logout", () => {
    const src = read("components/AccountSheet.tsx");
    expectTokens(src, "<Sheet", "setupItems", "/demo", "/api/auth/logout", "h-12", "tap");
  });
  it("MobileTopBar derives its title from pageTitle, is not a second <h1>, and opens the AccountSheet", () => {
    const src = read("components/MobileTopBar.tsx");
    expect(src.includes("pageTitle(pathname)")).toBe(true);
    expectTokens(src, "<AccountSheet", "md:hidden", "h-12", "aria-hidden=");
    expect(src.includes("<h1")).toBe(false);
  });
  it("the theme toggle keeps <meta name=theme-color> in step with data-theme, and the top bar syncs it on load", () => {
    const toggle = read("components/ThemeToggle.tsx");
    expect(toggle.includes('meta[name="theme-color"]')).toBe(true);
    expectTokens(toggle, "syncThemeColorMeta", "#f7f6f4", "#161619");
    expect(read("components/MobileTopBar.tsx").includes("syncThemeColorMeta()")).toBe(true);
  });
});

describe("grep guard: global CSS foundations", () => {
  const css = read("app/globals.css");
  it("has .tap, .pb-safe, hover-reveal, 16px inputs below md, touch-action, text-size-adjust", () => {
    expect(/\.tap\s*\{\s*@apply min-h-11 min-w-11;/.test(css)).toBe(true);
    expect(css.includes(".pb-safe")).toBe(true);
    expect(css.includes("env(safe-area-inset-bottom)")).toBe(true);
    expect(/@media \(hover: none\)\s*\{\s*\.hover-reveal\s*\{\s*opacity: 1;/.test(css)).toBe(true);
    expect(/@media \(max-width: 767px\)\s*\{\s*input,\s*select,\s*textarea,\s*\.field\s*\{\s*font-size: 16px/.test(css)).toBe(true);
    expect(css.includes("touch-action: manipulation")).toBe(true);
    expect(css.includes("-webkit-text-size-adjust: 100%")).toBe(true);
  });
  it("driver.js popovers fit a phone", () => {
    expect(css.includes("max-width: min(320px, calc(100vw - 32px))")).toBe(true);
  });
  it("sheet motion respects reduced motion", () => {
    expect(/prefers-reduced-motion: reduce\)\s*\{\s*\.sheet-backdrop,\s*\.sheet-panel\s*\{\s*animation: none;/.test(css)).toBe(true);
  });
});

describe("home-screen install: manifest + viewport", () => {
  it("manifest parses, is standalone, starts on /dashboard, and points at real icons", () => {
    const m = JSON.parse(read("public/manifest.webmanifest"));
    expect(m.name).toBe("Navo");
    expect(m.short_name).toBe("Navo");
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/dashboard");
    expect(Array.isArray(m.icons) && m.icons.length >= 2).toBe(true);
    for (const icon of m.icons) {
      const local = `public${icon.src}`.replace("public/icon.svg", "app/icon.svg");
      expect(() => readFileSync(local)).not.toThrow();
    }
  });
  it("app/layout.tsx exports viewport with viewportFit cover and the manifest/apple metadata", () => {
    const src = read("app/layout.tsx");
    expect(src.includes("export const viewport: Viewport")).toBe(true);
    expectTokens(src, "viewportFit:", "cover", "manifest:", "/manifest.webmanifest", "appleWebApp:");
  });
  it("the theme colors are the brand canvas/ink tokens, in the layout, the toggle and the manifest", () => {
    const m = JSON.parse(read("public/manifest.webmanifest"));
    expectTokens(read("app/layout.tsx"), "#f7f6f4", "#161619");
    expect(m.theme_color).toBe("#f7f6f4");
    expect(m.background_color).toBe("#f7f6f4");
  });
});
