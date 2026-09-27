// Theme persistence (Task D): the choice must stick in every browser — private
// mode, storage-blocked profiles, iOS Home-Screen apps. The cookie is primary
// (server-rendered + read pre-paint), localStorage the legacy fallback. Pure
// tests for lib/theme, a behavioural run of the pre-paint bootstrap against a
// fake document, and grep guards on the wiring.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import {
  asTheme,
  parseThemeCookie,
  themeBootstrapScript,
  themeCookieString,
  THEME_COOKIE,
  THEME_KEY,
  type Theme,
} from "@/lib/theme";

const read = (p: string) => readFileSync(p, "utf8");

describe("constants", () => {
  it("cookie name and the legacy localStorage key", () => {
    expect(THEME_COOKIE).toBe("navo_theme");
    expect(THEME_KEY).toBe("flowboard-theme");
  });
});

describe("asTheme", () => {
  it("accepts exactly light/dark", () => {
    expect(asTheme("light")).toBe("light");
    expect(asTheme("dark")).toBe("dark");
  });
  it("rejects anything else", () => {
    for (const v of ["Dark", " dark", "", "system", null, undefined, 1, {}, ["dark"]]) expect(asTheme(v)).toBeNull();
  });
});

describe("parseThemeCookie", () => {
  it("missing header or cookie → null", () => {
    expect(parseThemeCookie(undefined)).toBeNull();
    expect(parseThemeCookie("")).toBeNull();
    expect(parseThemeCookie("session=abc; other=1")).toBeNull();
  });
  it("reads the value alone and among other cookies", () => {
    expect(parseThemeCookie("navo_theme=dark")).toBe("dark");
    expect(parseThemeCookie("session=abc; navo_theme=light; x=y")).toBe("light");
  });
  it("tolerates spaces and quoted values", () => {
    expect(parseThemeCookie("  a=1 ;   navo_theme = dark  ; b=2")).toBe("dark");
    expect(parseThemeCookie('navo_theme="dark"')).toBe("dark");
  });
  it("malformed values → null", () => {
    expect(parseThemeCookie("navo_theme=blue")).toBeNull();
    expect(parseThemeCookie("navo_theme=")).toBeNull();
    expect(parseThemeCookie("navo_theme")).toBeNull();
    expect(parseThemeCookie(";;;=;navo_theme=DARK")).toBeNull();
  });
  it("does not match a cookie whose name merely contains navo_theme", () => {
    expect(parseThemeCookie("x_navo_theme=dark; navo_theme_old=dark")).toBeNull();
  });
  it("multiple navo_theme cookies: the first well-formed one wins", () => {
    expect(parseThemeCookie("navo_theme=dark; navo_theme=light")).toBe("dark");
    expect(parseThemeCookie("navo_theme=junk; navo_theme=light")).toBe("light");
  });
});

describe("themeCookieString", () => {
  it("one-year, site-wide, SameSite=Lax; no Secure on http", () => {
    const s = themeCookieString("dark", false);
    expect(s).toBe("navo_theme=dark; Path=/; Max-Age=31536000; SameSite=Lax");
    expect(s.includes("Secure")).toBe(false);
  });
  it("adds Secure on https", () => {
    expect(themeCookieString("light", true)).toBe("navo_theme=light; Path=/; Max-Age=31536000; SameSite=Lax; Secure");
  });
  it("round-trips through parseThemeCookie (the name=value pair)", () => {
    for (const t of ["light", "dark"] as Theme[]) expect(parseThemeCookie(themeCookieString(t, true).split(";")[0])).toBe(t);
  });
});

// Run the real bootstrap string against a tiny fake browser. `ls` null = storage
// blocked (getItem/setItem throw); `cookieBlocked` = document.cookie throws.
function runBootstrap(opts: { cookie?: string; ls?: Record<string, string> | null; cookieBlocked?: boolean; https?: boolean }) {
  const colors = { light: "#f7f6f4", dark: "#161619" };
  const attrs: Record<string, string> = { "data-theme": "light" };
  const metas = [{ content: "", setAttribute(_k: string, v: string) { this.content = v; } }];
  const written: string[] = [];
  let listener: (() => void) | null = null;
  const document = {
    documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) },
    querySelectorAll: (sel: string) => (sel === 'meta[name="theme-color"]' ? metas : []),
    addEventListener: (_e: string, f: () => void) => (listener = f),
  };
  Object.defineProperty(document, "cookie", {
    get() {
      if (opts.cookieBlocked) throw new Error("SecurityError");
      return opts.cookie ?? "";
    },
    set(v: string) {
      if (opts.cookieBlocked) throw new Error("SecurityError");
      written.push(v);
    },
  });
  const store = opts.ls === undefined ? {} : opts.ls;
  const localStorage = {
    getItem(k: string) {
      if (store === null) throw new Error("SecurityError");
      return k in store ? store[k] : null;
    },
  };
  const location = { protocol: opts.https ? "https:" : "http:" };
  new Function("document", "localStorage", "location", themeBootstrapScript(colors))(document, localStorage, location);
  return { theme: attrs["data-theme"], meta: metas[0].content, written, listener: listener as (() => void) | null };
}

describe("pre-paint bootstrap (behaviour)", () => {
  it("cookie wins over localStorage", () => {
    const r = runBootstrap({ cookie: "a=1; navo_theme=dark", ls: { [THEME_KEY]: "light" } });
    expect(r.theme).toBe("dark");
    expect(r.written).toEqual([]);
  });
  it("storage blocked: the cookie alone still gives the right theme", () => {
    expect(runBootstrap({ cookie: "navo_theme=dark", ls: null }).theme).toBe("dark");
  });
  it("no cookie: falls back to legacy localStorage and migrates it into the cookie", () => {
    const r = runBootstrap({ ls: { [THEME_KEY]: "dark" }, https: true });
    expect(r.theme).toBe("dark");
    expect(r.written).toEqual([themeCookieString("dark", true)]);
    expect(runBootstrap({ ls: { [THEME_KEY]: "dark" } }).written).toEqual([themeCookieString("dark", false)]);
  });
  it("cookies blocked: localStorage still works", () => {
    expect(runBootstrap({ cookieBlocked: true, ls: { [THEME_KEY]: "dark" } }).theme).toBe("dark");
  });
  it("nothing stored / junk / everything blocked → light", () => {
    expect(runBootstrap({}).theme).toBe("light");
    expect(runBootstrap({ cookie: "navo_theme=blue", ls: { [THEME_KEY]: "purple" } }).theme).toBe("light");
    expect(runBootstrap({ cookieBlocked: true, ls: null }).theme).toBe("light");
  });
  it("points theme-color at the chosen theme, and re-syncs at DOMContentLoaded", () => {
    const dark = runBootstrap({ cookie: "navo_theme=dark" });
    expect(dark.meta).toBe("#161619");
    expect(typeof dark.listener).toBe("function");
    expect(runBootstrap({}).meta).toBe("#f7f6f4");
  });
});

describe("grep guard: wiring", () => {
  const layout = read("app/layout.tsx");
  const lib = read("lib/theme.ts");
  const toggle = read("components/ThemeToggle.tsx");
  it("root layout server-renders data-theme from the cookie via cookies()", () => {
    expect(layout.includes('from "next/headers"')).toBe(true);
    expect(layout.includes("await cookies()")).toBe(true);
    expect(layout.includes("THEME_COOKIE")).toBe(true);
    expect(layout.includes('data-theme={cookieTheme ?? "light"}')).toBe(true);
    expect(layout.includes("suppressHydrationWarning")).toBe(true);
    expect(layout.includes("themeBootstrapScript(")).toBe(true);
  });
  it("the bootstrap reads document.cookie before localStorage", () => {
    const script = themeBootstrapScript({ light: "#f7f6f4", dark: "#161619" });
    const c = script.indexOf("document.cookie");
    const l = script.indexOf("localStorage");
    expect(c).toBeGreaterThanOrEqual(0);
    expect(l).toBeGreaterThan(c);
    const fn = lib.slice(lib.indexOf("export function themeBootstrapScript"));
    expect(fn.indexOf("document.cookie")).toBeLessThan(fn.indexOf("localStorage"));
  });
  it("ThemeToggle writes BOTH the cookie and localStorage, and applies the cookie on mount", () => {
    expect(toggle.includes("document.cookie = themeCookieString(")).toBe(true);
    expect(toggle.includes("localStorage.setItem(THEME_KEY")).toBe(true);
    expect(toggle.includes("parseThemeCookie(document.cookie)")).toBe(true);
    expect(toggle.includes("syncThemeColorMeta()")).toBe(true);
  });
  it("no private copies of the storage names", () => {
    for (const src of [layout, toggle]) {
      expect(src.includes('"flowboard-theme"')).toBe(false);
      expect(src.includes('"navo_theme"')).toBe(false);
    }
  });
});
