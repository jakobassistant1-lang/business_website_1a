// Server-safe sanitizer for the Canvas assignment brief (ticket #131).
//
// Canvas hands us arbitrary teacher-authored HTML. It used to be sanitized in the
// browser with DOMPurify (needs a real DOM), so first paint showed escaped plain
// text and then flickered to formatted HTML. The server can't use DOMPurify
// without jsdom, and jsdom in the server bundle 500'd /assignment/[id] on Vercel
// (ERR_REQUIRE_ESM). `sanitize-html` is htmlparser2-based — no DOM, no jsdom —
// so the brief is now sanitized on the server and rendered on first paint.
//
// Baseline = the old browser config:
//   DOMPurify { USE_PROFILES: { html: true }, ADD_ATTR: ["target"],
//               FORBID_TAGS: ["style", "iframe", "form", "input", "script"] }
//   + an afterSanitizeAttributes hook forcing target=_blank rel=noopener
//     noreferrer on outbound links.
// i.e. DOMPurify's HTML tag + attribute allowlists (no SVG, no MathML), data-*
// and aria-* attributes, its URI allowlist applied to every non-inert attribute
// value, "drop the content too" for script/style/iframe/svg/math/noscript/…, and
// "unwrap, keep the text" for every other disallowed tag.
//
// Tightened after the #131 security review (the brief is now in the SSR HTML,
// before our hydration scripts, so it must not be able to impersonate the app):
//   - No `class` (it could apply OUR Tailwind classes, e.g. "fixed inset-0 z-50").
//   - `style` is parsed and reduced to a typography/box allowlist — no position,
//     z-index, inset/top/left, transform, display, url(), var(), calc().
//   - No top-layer UI: no <dialog>, no popover / popovertarget / command /
//     commandfor attributes. No <template> (dropped with its content).
//   - Links (<a> AND <area>): any authored target/rel is removed; outbound links
//     get target="_blank" rel="noopener noreferrer"; in-page "#" links get none.
//   - URLs: protocol-relative ("//x", "\\x", "/\x") dropped; relative ones are
//     resolved against the student's Canvas host when known, else dropped.
//     <img src> must end up absolute http(s) or data:image/…; srcset is dropped;
//     no data: on audio/video/source/track.
//   - DOM clobbering: every id/name (and every attribute that references one,
//     plus "#frag" hrefs) is prefixed with "brief-", like GitHub's
//     "user-content-". In-page anchors keep working.
//   - Input is capped at MAX_BRIEF_CHARS and MAX_TAGS; nesting at NESTING_LIMIT.
//
// Pure and synchronous; never throws (returns "" on any failure).
//
// Not `import "server-only"`: that package isn't installed as a top-level module
// here (Next only aliases it inside its own bundler), so vitest/tsx couldn't load
// this file. It's server-only by usage: only app/(app)/assignment/[id]/page.tsx
// imports it, and a guard test keeps the client component from doing so.

import sanitizeHtml from "sanitize-html";
import { MAX_BRIEF_CHARS } from "./limits";

export { MAX_BRIEF_CHARS };

/** Deeper tags are unwrapped (text kept) — bounds output depth on nesting bombs. */
const NESTING_LIMIT = 200;
/** Max "<" (≈ tags) we hand the parser. htmlparser2's cost grows faster than
 *  linearly with nesting depth (66k nested <b> ≈ 0.25s in the parser alone), so
 *  the char cap isn't enough on its own; real briefs have a few hundred tags. */
const MAX_TAGS = 20_000;

/** Cut the input just before its (MAX_TAGS+1)-th "<". Linear, no parsing. */
function capTags(s: string): string {
  let i = -1;
  for (let n = 0; n <= MAX_TAGS; n++) {
    i = s.indexOf("<", i + 1);
    if (i < 0) return s;
  }
  return s.slice(0, i);
}

// DOMPurify 3.x `html` tag profile, minus FORBID_TAGS (style, iframe, form, input,
// script), the document-level tags (html, head, body), and the review's removals
// (dialog, template).
const ALLOWED_TAGS = [
  "a", "abbr", "acronym", "address", "area", "article", "aside", "audio", "b", "bdi", "bdo", "big",
  "blink", "blockquote", "br", "button", "canvas", "caption", "center", "cite", "code", "col",
  "colgroup", "content", "data", "datalist", "dd", "decorator", "del", "details", "dfn",
  "dir", "div", "dl", "dt", "element", "em", "fieldset", "figcaption", "figure", "font", "footer",
  "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "i", "img", "ins", "kbd", "label",
  "legend", "li", "main", "map", "mark", "marquee", "menu", "menuitem", "meter", "nav", "nobr", "ol",
  "optgroup", "option", "output", "p", "picture", "pre", "progress", "q", "rp", "rt", "ruby", "s",
  "samp", "search", "section", "select", "shadow", "slot", "small", "source", "spacer", "span",
  "strike", "strong", "sub", "summary", "sup", "table", "tbody", "td", "textarea",
  "tfoot", "th", "thead", "time", "tr", "track", "tt", "u", "ul", "var", "video", "wbr",
];

// DOMPurify 3.x `html` attribute profile + ADD_ATTR ["target"] + data-* / aria-*,
// minus: class, srcset, command, commandfor, popover, popovertarget,
// popovertargetaction. No on* handler is on the list, so every event handler is
// dropped. `target`/`rel` on links are rewritten by the link rule below.
const ALLOWED_ATTRS = [
  "accept", "action", "align", "alt", "autocapitalize", "autocomplete", "autopictureinpicture",
  "autoplay", "background", "bgcolor", "border", "capture", "cellpadding", "cellspacing", "checked",
  "cite", "clear", "color", "cols", "colspan", "controls",
  "controlslist", "coords", "crossorigin", "datetime", "decoding", "default", "dir", "disabled",
  "disablepictureinpicture", "disableremoteplayback", "download", "draggable", "enctype",
  "enterkeyhint", "exportparts", "face", "for", "headers", "height", "hidden", "high", "href",
  "hreflang", "id", "inert", "inputmode", "integrity", "ismap", "kind", "label", "lang", "list",
  "loading", "loop", "low", "max", "maxlength", "media", "method", "min", "minlength", "multiple",
  "muted", "name", "nonce", "noshade", "novalidate", "nowrap", "open", "optimum", "part", "pattern",
  "placeholder", "playsinline", "poster",
  "preload", "pubdate", "radiogroup", "readonly", "rel", "required", "rev", "reversed", "role",
  "rows", "rowspan", "spellcheck", "scope", "selected", "shape", "size", "sizes", "slot", "span",
  "srclang", "start", "src", "step", "style", "summary", "tabindex", "title", "translate", "type",
  "usemap", "valign", "value", "width", "wrap", "xmlns",
  "target",
  "data-*",
  "aria-*",
];

// Disallowed tags whose CONTENT is dropped too (DOMPurify's FORBID_CONTENTS for the
// tags we don't allow, plus sanitize-html's own raw-text defaults incl. `xmp`).
// Anything else that's disallowed is unwrapped and its text kept.
const DROP_WITH_CONTENT = [
  "script", "style", "iframe", "noscript", "noembed", "noframes", "plaintext", "xmp", "title",
  "head", "svg", "math", "mi", "mn", "mo", "ms", "mtext", "annotation-xml", "desc",
  "foreignobject", "selectedcontent", "textarea", "option", "template",
];

// --- inline style allowlist ------------------------------------------------------
// Values are built from inert tokens only: non-negative lengths, hex/rgb/hsl colours
// and bare keywords. No url(), var(), calc(), expression(), no negative offsets.
const LEN = String.raw`(?:0|\d*\.?\d+(?:px|em|rem|%|pt|pc|cm|mm|in|ex|ch)|auto)`;
const COLOR = String.raw`(?:#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\(\s*[\d.%\s,/deg]+\)|[a-z]{3,20})`;
const WORD = String.raw`[a-z-]{2,20}`;
const re = (body: string) => [new RegExp(`^(?:${body})$`, "i")];
const one = (t: string) => re(t);
const upTo4 = (t: string) => re(`${t}(?:\\s+${t}){0,3}`);
const BORDER_TOKEN = `(?:${LEN}|thin|medium|thick|none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset|${COLOR})`;
const BOX = upTo4(LEN);
const BORDER = upTo4(BORDER_TOKEN);
const ALLOWED_STYLES: Record<string, RegExp[]> = {
  color: one(COLOR),
  "background-color": one(COLOR),
  "text-align": one("left|right|center|justify|start|end"),
  "font-weight": one(`normal|bold|bolder|lighter|[1-9]00`),
  "font-style": one("normal|italic|oblique"),
  "text-decoration": upTo4(`(?:none|underline|overline|line-through|solid|double|dotted|dashed|wavy|${COLOR})`),
  "font-size": one(`${LEN}|xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger`),
  width: one(LEN),
  "max-width": one(`${LEN}|none`),
  height: one(LEN),
  "vertical-align": one(`baseline|sub|super|top|text-top|middle|bottom|text-bottom|${LEN}`),
  float: one("left|right|none"),
  "list-style-type": one(WORD),
  "border-collapse": one("collapse|separate"),
};
for (const side of ["", "-top", "-right", "-bottom", "-left"]) {
  ALLOWED_STYLES[`margin${side}`] = BOX;
  ALLOWED_STYLES[`padding${side}`] = BOX;
  ALLOWED_STYLES[`border${side}`] = BORDER;
  ALLOWED_STYLES[`border${side}-width`] = upTo4(`(?:${LEN}|thin|medium|thick)`);
  ALLOWED_STYLES[`border${side}-style`] = upTo4("none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset");
  ALLOWED_STYLES[`border${side}-color`] = upTo4(COLOR);
}

// --- URLs ------------------------------------------------------------------------
// DOMPurify's URI allowlist, applied (like DOMPurify) to every attribute value
// except the inert ones below, after stripping whitespace/control characters.
const IS_ALLOWED_URI = /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;
// eslint-disable-next-line no-control-regex
const ATTR_WHITESPACE = /[\u0000-\u0020\u00A0\u1680\u180E\u2000-\u2029\u205F\u3000\uFEFF\u00AD\u200B]/g;
const WS = ATTR_WHITESPACE.source; // "[...]"
const TRIM_WS = new RegExp(`^${WS}+|${WS}+$`, "g");
const URI_SAFE_ATTRS = new Set([
  "alt", "for", "id", "label", "name", "pattern", "placeholder", "role", "summary", "title",
  "value", "style", "xmlns",
]);
const URL_SCHEMES = ["http", "https", "ftp", "ftps", "mailto", "tel", "callto", "sms", "cid", "xmpp", "matrix"];
// Attributes whose value is a URL we normalise (trim, drop protocol-relative,
// resolve relative against the Canvas host).
const URL_ATTRS = new Set(["href", "src", "poster", "cite", "background", "action"]);
const HAS_SCHEME = /^[a-z][a-z0-9+.\-]*:/i;
const PROTOCOL_RELATIVE = /^[\\/]{2}/;
const IMG_SRC_OK = /^(?:https?:\/\/|data:image\/)/i;
const HOST_OK = /^[a-z0-9](?:[a-z0-9.\-]*[a-z0-9])?(?::\d{1,5})?$/i;

/** Browser-equivalent cleanup of a URL attribute: trim leading/trailing
 *  whitespace/control chars and drop the tab/CR/LF the URL parser ignores. */
const cleanUrl = (v: string) => v.replace(/[\t\n\r]/g, "").replace(TRIM_WS, "");

/** Returns the URL to keep, or null to drop the attribute. */
function normalizeUrl(value: string, origin: string | null): string | null {
  const v = cleanUrl(value);
  if (!v) return null;
  if (v.startsWith("#")) return v;
  if (PROTOCOL_RELATIVE.test(v)) return null;
  if (HAS_SCHEME.test(v.replace(ATTR_WHITESPACE, ""))) return v; // scheme checks below
  if (!origin) return null; // relative to OUR origin would be meaningless (or worse)
  try {
    const abs = new URL(v, origin);
    return abs.origin === origin ? abs.href : null;
  } catch {
    return null;
  }
}

// --- anti-clobbering namespace ------------------------------------------------------
const ID_PREFIX = "brief-";
const ID_ATTRS = new Set(["id", "name"]);
// Attributes holding a space-separated list of ids.
const ID_REF_ATTRS = new Set([
  "for", "headers", "list",
  "aria-labelledby", "aria-describedby", "aria-controls", "aria-owns", "aria-activedescendant",
  "aria-details", "aria-errormessage", "aria-flowto",
]);

const prefixId = (v: string) => (v.startsWith(ID_PREFIX) ? v : ID_PREFIX + v);
const prefixIdList = (v: string) => v.split(/\s+/).filter(Boolean).map(prefixId).join(" ");
// "#frag" → "#brief-frag"; a bare "#" stays as-is.
const prefixFragment = (v: string) => (v.length > 1 ? "#" + prefixId(v.slice(1)) : v);

function makeTransform(origin: string | null) {
  return function transformAttributes(tagName: string, attribs: sanitizeHtml.Attributes): sanitizeHtml.Tag {
    const isLink = tagName === "a" || tagName === "area";
    const out: sanitizeHtml.Attributes = {};
    for (const [rawName, rawValue] of Object.entries(attribs)) {
      const name = rawName.toLowerCase();
      if (isLink && (name === "target" || name === "rel")) continue; // re-added below
      let value = rawValue;

      if (URL_ATTRS.has(name)) {
        const url = normalizeUrl(value, origin);
        if (url == null) continue;
        value = url;
      }

      const isDataOrAria = /^data-[\-\w.\u00B7-\uFFFF]+$/.test(name) || /^aria-[\-\w]+$/.test(name);
      const compact = value.replace(ATTR_WHITESPACE, "");
      const imgSrc = tagName === "img" && name === "src";

      // DOMPurify's value check: inert attributes and data-/aria- pass; everything
      // else must look like an allowed URI (or not like a URI at all).
      if (!isDataOrAria && !URI_SAFE_ATTRS.has(name) && value && !IS_ALLOWED_URI.test(compact)) {
        if (!(imgSrc && IMG_SRC_OK.test(compact))) continue;
      }
      // Images: absolute http(s) or data:image/ only.
      if (imgSrc && !IMG_SRC_OK.test(compact)) continue;

      if (ID_ATTRS.has(name)) {
        if (value.trim()) out[rawName] = prefixId(value.trim());
        continue;
      }
      if (ID_REF_ATTRS.has(name)) {
        const list = prefixIdList(value);
        if (list) out[rawName] = list;
        continue;
      }
      if ((name === "href" || name === "usemap") && value.startsWith("#")) {
        out[rawName] = prefixFragment(value);
        continue;
      }
      out[rawName] = value;
    }

    // The old afterSanitizeAttributes hook, now for <a> AND <area>: outbound links
    // open in a new tab and can't reach back to our window; in-page "#" links and
    // bare anchors carry no target/rel at all (any authored ones were dropped above).
    if (isLink && out.href && !out.href.startsWith("#")) {
      out.target = "_blank";
      out.rel = "noopener noreferrer";
    }
    return { tagName, attribs: out };
  };
}

function optionsFor(origin: string | null): sanitizeHtml.IOptions {
  return {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { "*": ALLOWED_ATTRS },
    allowedStyles: { "*": ALLOWED_STYLES },
    parseStyleAttributes: true,
    disallowedTagsMode: "discard",
    nonTextTags: DROP_WITH_CONTENT,
    allowVulnerableTags: false,
    nestingLimit: NESTING_LIMIT,
    // Second, independent scheme check on URL-bearing attributes (href, src, cite,
    // poster, background, usemap, action, formaction, xlink:href, …).
    allowedSchemes: URL_SCHEMES,
    allowedSchemesByTag: {
      img: ["http", "https", "data"],
      audio: ["http", "https"],
      video: ["http", "https"],
      source: ["http", "https"],
      track: ["http", "https"],
    },
    allowProtocolRelative: false,
    selfClosing: ["img", "br", "hr", "area", "col", "wbr", "source", "track"],
    transformTags: { "*": makeTransform(origin) },
  };
}

const DEFAULT_OPTIONS = optionsFor(null);

/** Canvas host ("school.instructure.com", as stored on the credential) → origin. */
function canvasOrigin(canvasHost: string | null | undefined): string | null {
  if (typeof canvasHost !== "string") return null;
  const host = canvasHost.trim().toLowerCase();
  if (!HOST_OK.test(host)) return null;
  try {
    return new URL(`https://${host}`).origin;
  } catch {
    return null;
  }
}

/**
 * Sanitize a Canvas brief for direct rendering. `canvasHost` (optional) is the
 * student's Canvas host; relative links/images are resolved against it (and
 * dropped when it's unknown).
 */
export function sanitizeBrief(html: string, canvasHost?: string | null): string {
  if (typeof html !== "string" || !html) return "";
  try {
    const input = capTags(html.length > MAX_BRIEF_CHARS ? html.slice(0, MAX_BRIEF_CHARS) : html);
    const origin = canvasOrigin(canvasHost);
    return sanitizeHtml(input, origin ? optionsFor(origin) : DEFAULT_OPTIONS);
  } catch {
    return "";
  }
}
