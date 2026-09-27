// The light/dark theme choice — ONE place for its storage names and cookie
// format. Pure (no node, no DOM): the server root layout, the pre-paint
// bootstrap script and the client toggle all read these.
//
// Persistence is belt-and-braces so the choice survives every browser:
//   - the cookie is the primary store — the server reads it and renders
//     <html data-theme> correctly on first paint, even with JS/storage blocked;
//   - localStorage (the legacy Flowboard key) is the fallback / migration source.

export type Theme = "light" | "dark";

/** Cookie the server renders <html data-theme> from. */
export const THEME_COOKIE = "navo_theme";

/** The browser-chrome colour per theme: the --bg tokens from app/globals.css
 *  (metadata and the pre-paint script can't read CSS variables). The ONLY raw
 *  hex in the app — keep in sync with the tokens and public/manifest.webmanifest. */
export const THEME_HEX: Record<Theme, string> = { light: "#f7f6f4", dark: "#161619" };
/** Legacy localStorage key (kept so existing choices still load). */
export const THEME_KEY = "flowboard-theme";
/** One year. */
export const THEME_COOKIE_MAX_AGE = 31536000;
/** Every attribute except `Secure` (which depends on the page protocol). */
export const THEME_COOKIE_ATTRS = `Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;

/** Narrow anything to a Theme, or null when it isn't exactly "light"/"dark". */
export function asTheme(v: unknown): Theme | null {
  return v === "light" || v === "dark" ? v : null;
}

/** Read the theme from a raw `Cookie` header / `document.cookie` string.
 *  Tolerates spaces, other cookies, quoted values and junk pairs; the first
 *  well-formed `navo_theme` wins. Missing or malformed → null. */
export function parseThemeCookie(cookieHeader: string | undefined): Theme | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== THEME_COOKIE) continue;
    const raw = part.slice(eq + 1).trim().replace(/^"(.*)"$/, "$1");
    const t = asTheme(raw);
    if (t) return t;
  }
  return null;
}

/** The `document.cookie` assignment string that stores `theme` for a year.
 *  `secure` should be `location.protocol === "https:"` (passed in to stay pure). */
export function themeCookieString(theme: Theme, secure: boolean): string {
  return `${THEME_COOKIE}=${theme}; ${THEME_COOKIE_ATTRS}${secure ? "; Secure" : ""}`;
}

/** The inline <head> script that sets <html data-theme> before first paint.
 *  Order: `document.cookie` (navo_theme — the same value the server rendered
 *  from) → the legacy localStorage key (and, when found there, copy it into the
 *  cookie so the server renders it from then on) → light. Each store is read in
 *  its own try, so a browser that blocks storage (private mode, locked-down
 *  profiles) still gets the cookie value, and vice versa. Then it points every
 *  <meta name="theme-color"> at the chosen theme's `colors` hex — now, and again
 *  at DOMContentLoaded in case the metas are emitted after this script.
 *  ES5 only: it runs un-transpiled in every browser. */
export function themeBootstrapScript(colors: Record<Theme, string>): string {
  return (
    "(function(){var t=null;" +
    // 1. cookie — same parse as parseThemeCookie: first well-formed value wins
    "try{var p=document.cookie.split(';');for(var i=0;i<p.length;i++){var e=p[i].indexOf('=');if(e<0)continue;" +
    `if(p[i].slice(0,e).trim()!=='${THEME_COOKIE}')continue;` +
    `var v=p[i].slice(e+1).trim().replace(/^"(.*)"$/,'$1');if(v==='dark'||v==='light'){t=v;break;}}}catch(x){}` +
    // 2. legacy localStorage, migrated into the cookie
    `if(!t){try{var l=localStorage.getItem('${THEME_KEY}');if(l==='dark'||l==='light'){t=l;` +
    `try{document.cookie='${THEME_COOKIE}='+l+'; ${THEME_COOKIE_ATTRS}'+(location.protocol==='https:'?'; Secure':'');}catch(x){}}}catch(x){}}` +
    // 3. default, apply, sync the browser-chrome color
    "if(!t)t='light';document.documentElement.setAttribute('data-theme',t);" +
    `var c=t==='dark'?'${colors.dark}':'${colors.light}';` +
    "function s(){var m=document.querySelectorAll('meta[name=\"theme-color\"]');for(var j=0;j<m.length;j++)m[j].setAttribute('content',c);}" +
    "s();document.addEventListener('DOMContentLoaded',s);})();"
  );
}
