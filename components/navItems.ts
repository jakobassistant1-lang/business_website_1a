// Single source for the app shell's navigation (ticket #39). The desktop/tablet
// Sidebar and the phone MobileTabBar both read `navItems`, so the four phone tab
// destinations are, by construction, the sidebar's first four entries. The
// pure pathname helpers below are what MobileTopBar / MobileTabBar render from
// and what tests/mobileShell.test.ts pins.
import type { NavIconKey } from "./navIcons";

export type NavItem = {
  href: string;
  /** Sidebar label (tablet/desktop). */
  label: string;
  /** Phone tab-bar label — the shorter "glance and act" wording from the plan. */
  tabLabel: string;
  icon: NavIconKey;
};

/** Daily-use surfaces. The first FOUR are the phone tab bar, in order. */
export const navItems: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", tabLabel: "Today", icon: "dashboard" },
  { href: "/plan", label: "Plan", tabLabel: "Plan", icon: "plan" },
  { href: "/study", label: "Study", tabLabel: "Study", icon: "study" },
  { href: "/courses", label: "Courses", tabLabel: "Classes", icon: "courses" },
];

/** The phone tab bar: exactly the first four daily-use destinations. */
export const TAB_ITEMS = navItems.slice(0, 4);

/** Setup screens — the sidebar's account menu and the phone AccountSheet. */
export const setupItems: readonly { href: string; label: string; icon: NavIconKey }[] = [
  { href: "/connections", label: "Connections", icon: "connections" },
  { href: "/settings", label: "Settings", icon: "settings" },
  { href: "/account", label: "Account", icon: "account" },
];

/** Admin boards (sidebar only; the phone sheet links to the first one). */
export const adminItems: readonly { href: string; label: string; icon: NavIconKey; exact?: boolean }[] = [
  { href: "/admin", label: "Board", icon: "board", exact: true },
  { href: "/admin/marketing", label: "Marketing", icon: "marketing" },
  { href: "/admin/hierarchy", label: "Hierarchy", icon: "hierarchy" },
  { href: "/admin/burndown", label: "Burndown", icon: "burndown" },
  { href: "/admin/ai", label: "AI settings", icon: "ai" },
];

/** First path segment of a pathname ("/class/12/x" → "class"). */
function firstSegment(pathname: string): string {
  return pathname.split("?")[0].split("/").filter(Boolean)[0] ?? "";
}

/** Phone top-bar title, derived from the route. Unknown routes fall back to "Navo". */
export function pageTitle(pathname: string): string {
  const TITLES: Record<string, string> = {
    dashboard: "Today",
    plan: "Plan",
    study: "Study",
    courses: "Classes",
    class: "Class",
    assignment: "Assignment",
    connections: "Connections",
    settings: "Settings",
    account: "Account",
    admin: "Admin",
  };
  return TITLES[firstSegment(pathname)] ?? "Navo";
}

/** Which of the four tabs is "current" for a pathname (its href), or null.
 *  Detail routes count for the section they belong to: /assignment/* → Today,
 *  /class/* → Classes, /study/* → Study. Setup/admin routes light no tab. */
export function activeTabHref(pathname: string): string | null {
  const SECTION: Record<string, string> = {
    dashboard: "/dashboard",
    assignment: "/dashboard",
    plan: "/plan",
    study: "/study",
    courses: "/courses",
    class: "/courses",
  };
  return SECTION[firstSegment(pathname)] ?? null;
}

/** "Jane Q Doe" → "JD"; empty → "?". Shared by the sidebar avatar and the phone account button. */
export function initialsOf(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}
