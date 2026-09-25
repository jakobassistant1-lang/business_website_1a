// Ticket #39 (M1): the phone/tablet shell and its global foundations. Pure
// tests for the pathname helpers the shell renders from, plus grep guards so
// the shell's wiring (layout, sidebar breakpoints, tab bar, Sheet, CSS,
// manifest, viewport) can't be quietly undone by a later task.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { navItems, TAB_ITEMS, setupItems, pageTitle, activeTabHref, initialsOf } from "@/components/navItems";
import { NAV_ICONS } from "@/components/navIcons";

const read = (p: string) => readFileSync(p, "utf8");

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
    expect(src.includes("TAB_ITEMS")).toBe(true);
    expect(src.includes("activeTabHref(")).toBe(true);
    expect(/href="\//.test(src)).toBe(false);
  });
  it("is phone-only, fixed to the bottom, 56px + safe area, 44px targets, aria-current", () => {
    expect(src.includes("md:hidden")).toBe(true);
    expect(src.includes("fixed inset-x-0 bottom-0")).toBe(true);
    expect(src.includes("h-14")).toBe(true);
    expect(src.includes("pb-safe")).toBe(true);
    expect(src.includes("tap ")).toBe(true);
    expect(src.includes('aria-current={isActive ? "page" : undefined}')).toBe(true);
  });
});

describe("grep guard: the (app) layout wires the phone shell and keeps the access gate", () => {
  const src = read("app/(app)/layout.tsx");
  it("renders MobileTopBar above <main> and MobileTabBar after it", () => {
    const top = src.indexOf("<MobileTopBar");
    const main = src.indexOf("<main className");
    const tab = src.indexOf("<MobileTabBar");
    expect(top).toBeGreaterThan(-1);
    expect(tab).toBeGreaterThan(-1);
    expect(top).toBeLessThan(main);
    expect(tab).toBeGreaterThan(src.indexOf("</main>"));
  });
  it("still gates through accessDecision / DECISION_PATH and keeps the three banners", () => {
    expect(src.includes("accessDecision(")).toBe(true);
    expect(src.includes("DECISION_PATH[")).toBe(true);
    for (const el of ["<ConnectionAlert", "<TrialBanner", "<CancelScheduledNote", "<Sidebar"]) expect(src.includes(el)).toBe(true);
  });
  it("<main> guards horizontal overflow and reserves the tab-bar height on phones", () => {
    expect(src.includes("overflow-x-hidden")).toBe(true);
    expect(src.includes("pb-[calc(56px+env(safe-area-inset-bottom)+1rem)]")).toBe(true);
    expect(src.includes("min-h-dvh")).toBe(true);
  });
});

describe("grep guard: Sidebar breakpoints", () => {
  const src = read("components/Sidebar.tsx");
  it("is hidden below md and uses dvh, never 100vh", () => {
    expect(src.includes("hidden")).toBe(true);
    expect(src.includes("md:flex")).toBe(true);
    expect(src.includes("h-dvh")).toBe(true);
    expect(src.includes("h-screen")).toBe(false);
  });
  it("renders the shared navItems and icons (no private path strings)", () => {
    expect(src.includes("navItems")).toBe(true);
    expect(src.includes("NavIcon")).toBe(true);
    expect(/icon:\s*"M/.test(src)).toBe(false);
  });
  it("the collapse chevrons only exist at lg+ (tablets are always the rail)", () => {
    const chevrons = src.match(/aria-label="(Collapse|Expand) menu"[^>]*className="([^"]*)"/g) ?? [];
    expect(chevrons.length).toBe(2);
    for (const c of chevrons) expect(c.includes("lg:block")).toBe(true);
  });
});

describe("grep guard: Sheet and the phone account surfaces", () => {
  it("Sheet exports Sheet + useIsPhone, is a bottom sheet on phones and a dialog at md+", () => {
    const src = read("components/Sheet.tsx");
    expect(src.includes("export function Sheet(")).toBe(true);
    expect(src.includes("export function useIsPhone()")).toBe(true);
    expect(src.includes("(max-width: 767px)")).toBe(true);
    expect(src.includes("max-h-[85dvh]")).toBe(true);
    expect(src.includes("rounded-t-2xl")).toBe(true);
    expect(src.includes("md:max-w-md")).toBe(true);
    expect(src.includes('role="dialog"')).toBe(true);
    expect(src.includes('aria-modal="true"')).toBe(true);
    expect(src.includes("bg-ink/40")).toBe(true);
    expect(src.includes('e.key === "Escape"')).toBe(true);
  });
  it("AccountSheet uses Sheet with the sidebar's setup items, replay and logout", () => {
    const src = read("components/AccountSheet.tsx");
    expect(src.includes("<Sheet")).toBe(true);
    expect(src.includes("setupItems")).toBe(true);
    expect(src.includes('href="/demo"')).toBe(true);
    expect(src.includes('fetch("/api/auth/logout", { method: "POST" })')).toBe(true);
    expect(src.includes("h-12")).toBe(true);
  });
  it("MobileTopBar derives its title from pageTitle and opens the AccountSheet", () => {
    const src = read("components/MobileTopBar.tsx");
    expect(src.includes("pageTitle(pathname)")).toBe(true);
    expect(src.includes("<AccountSheet")).toBe(true);
    expect(src.includes("md:hidden")).toBe(true);
    expect(src.includes("h-12")).toBe(true);
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
    expect(src.includes('viewportFit: "cover"')).toBe(true);
    expect(src.includes('manifest: "/manifest.webmanifest"')).toBe(true);
    expect(src.includes("appleWebApp")).toBe(true);
  });
  it("the theme colors are the brand canvas/ink tokens, in both the layout and the manifest", () => {
    const layout = read("app/layout.tsx");
    const m = JSON.parse(read("public/manifest.webmanifest"));
    expect(layout.includes('color: "#f7f6f4"')).toBe(true);
    expect(layout.includes('color: "#161619"')).toBe(true);
    expect(m.theme_color).toBe("#f7f6f4");
    expect(m.background_color).toBe("#f7f6f4");
  });
});
