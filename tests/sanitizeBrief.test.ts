// Ticket #131: the Canvas assignment brief is sanitized on the SERVER with
// sanitize-html (no DOM, no jsdom) and rendered on first paint — no more
// escaped-text-then-HTML flicker. These tests pin the sanitizer's security
// semantics (the old DOMPurify config + link hook, tightened by the #131 security
// review) and guard that the browser-side DOMPurify path stays gone.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { sanitizeBrief, MAX_BRIEF_CHARS } from "@/lib/sanitizeBrief";

const HOST = "school.instructure.test";
const EXT = 'target="_blank" rel="noopener noreferrer"';

describe("sanitizeBrief: dangerous content is removed", () => {
  it("strips <script>, <iframe>, <style> — tag AND content", () => {
    const out = sanitizeBrief(
      '<p>Read this</p><script>alert(1)</script><iframe src="https://evil.test">frame text</iframe><style>p{color:red}</style>'
    );
    expect(out).toBe("<p>Read this</p>");
  });

  it("strips object/embed/form/input, keeping only plain fallback text", () => {
    const out = sanitizeBrief('<form action="https://evil.test"><input value="x">Name</form><object data="x.swf">fallback</object><embed src="x.swf">');
    expect(out).toBe("Namefallback");
  });

  it("strips document-level and navigation tags: <base>, <meta refresh>, <link>", () => {
    expect(sanitizeBrief('<base href="https://evil.test/">x')).toBe("x");
    expect(sanitizeBrief('<meta http-equiv="refresh" content="0;url=https://evil.test">x')).toBe("x");
    expect(sanitizeBrief('<link rel="stylesheet" href="https://evil.test/x.css">x')).toBe("x");
  });

  it("strips srcdoc and xlink:href", () => {
    expect(sanitizeBrief('<iframe srcdoc="<script>alert(1)</script>"></iframe><div srcdoc="x">d</div>')).toBe("<div>d</div>");
    expect(sanitizeBrief('<a xlink:href="javascript:alert(1)">a</a>')).toBe("<a>a</a>");
  });

  it("strips event handlers, whatever the case or tag (img, details ontoggle, video/source onerror)", () => {
    expect(sanitizeBrief('<img src="https://x.test/a.png" onerror="alert(1)"><b onclick="x()" onmouseover="y()">b</b>')).toBe(
      '<img src="https://x.test/a.png" /><b>b</b>'
    );
    expect(sanitizeBrief('<img SRC="https://x.test/a.png" ONERROR="alert(1)">')).toBe('<img src="https://x.test/a.png" />');
    expect(sanitizeBrief("<details open ontoggle=alert(1)>d</details>")).toBe("<details open>d</details>");
    expect(sanitizeBrief('<video><source onerror=alert(1) src="javascript:x"></video>')).toBe("<video><source /></video>");
  });

  it("fullwidth look-alike attribute names are not on the allowlist", () => {
    // U+FF4F FULLWIDTH LATIN SMALL LETTER O
    const out = sanitizeBrief(`<img src="https://x.test/a.png" ${String.fromCharCode(0xff4f)}nerror="alert(1)">`);
    expect(out).toBe('<img src="https://x.test/a.png" />');
  });

  it("strips javascript:/vbscript:/data: hrefs (incl. entity-encoded and obfuscated), keeping the link text", () => {
    const hrefs = [
      "javascript:alert(1)",
      "  JaVaScRiPt:alert(1)",
      "&#106;avascript:alert(1)",
      "&#x6A;avascript&#x3A;alert(1)",
      "javascript&colon;alert(1)",
      "java&#x09;script:alert(1)",
      String.fromCharCode(1) + "javascript:alert(1)",
      String.fromCharCode(0x200b) + "javascript:alert(1)",
      "vbscript:msgbox(1)",
      "data:text/html,<script>alert(1)</script>",
    ];
    for (const href of hrefs) expect(sanitizeBrief(`<a href="${href}">click</a>`, HOST), href).toBe("<a>click</a>");
  });

  it("poster/background/cite with javascript: are dropped", () => {
    expect(sanitizeBrief('<video poster="javascript:alert(1)" src="https://x.test/v.mp4"></video>')).toBe('<video src="https://x.test/v.mp4"></video>');
    expect(sanitizeBrief('<table background="javascript:alert(1)"><tr><td>x</td></tr></table>')).toBe("<table><tr><td>x</td></tr></table>");
    expect(sanitizeBrief('<blockquote cite="javascript:alert(1)">q</blockquote>')).toBe("<blockquote>q</blockquote>");
  });

  it("a nested <svg><script> payload leaves nothing executable", () => {
    const out = sanitizeBrief('<svg><script>alert(1)</script><a href="javascript:alert(2)">x</a><foreignObject><img src=x onerror=alert(3)></foreignObject></svg>after');
    expect(out).toBe("after");
  });

  it("<template> is dropped with its contents (no declarative shadow DOM in the SSR HTML)", () => {
    expect(sanitizeBrief('<template><img src=x onerror=alert(1)><script>alert(1)</script></template>after')).toBe("after");
    expect(sanitizeBrief('<template shadowrootmode="open"><style>*{display:none}</style></template>after')).toBe("after");
  });

  it("mXSS classics are neutralised (math/style, noscript-in-attribute, xmp, textarea)", () => {
    expect(sanitizeBrief("<math><mi><style><img src=x onerror=alert(1)>")).toBe("");
    expect(sanitizeBrief('<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>')).toBe("");
    expect(sanitizeBrief("<xmp><img src=x onerror=alert(1)></xmp>")).toBe("");
    expect(sanitizeBrief("<textarea><img src=x onerror=alert(1)></textarea>")).toBe("<textarea>&lt;img src=x onerror=alert(1)&gt;</textarea>");
  });
});

describe("sanitizeBrief: no page-covering or top-layer UI (review items 2 + 3)", () => {
  it("drops `class` entirely — our own Tailwind classes can't be borrowed", () => {
    expect(sanitizeBrief('<div class="fixed inset-0 z-50 bg-surface">SPOOF</div>')).toBe("<div>SPOOF</div>");
  });

  it("reduces inline style to the typography/box allowlist", () => {
    expect(sanitizeBrief('<div style="position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:99999;background:white">SPOOF</div>')).toBe(
      "<div>SPOOF</div>"
    );
    expect(sanitizeBrief('<p style="color:red;position:absolute;inset:0;transform:scale(9);display:block">s</p>')).toBe('<p style="color:red">s</p>');
    expect(sanitizeBrief('<div style="background:url(javascript:alert(1));background-image:url(https://evil.test/t.png)">d</div>')).toBe("<div>d</div>");
    expect(sanitizeBrief('<p style="margin:-9999px;width:calc(100% + 1px);color:var(--x)">m</p>')).toBe("<p>m</p>");
    const keep =
      "color:#333;background-color:rgb(255, 255, 0);text-align:center;font-weight:bold;font-style:italic;" +
      "text-decoration:underline;font-size:14px;width:50%;max-width:600px;height:auto;margin:0 auto;padding-left:8px;" +
      "border:1px solid #ccc;border-collapse:collapse;vertical-align:top;float:right;list-style-type:lower-alpha";
    expect(sanitizeBrief(`<p style="${keep}">k</p>`)).toBe(`<p style="${keep}">k</p>`);
  });

  it("drops <dialog> (content kept inline) and command/commandfor", () => {
    const out = sanitizeBrief(
      '<button commandfor="d" command="show-modal">View rubric</button><dialog id="d" style="width:100vw;height:100vh">Session expired</dialog>'
    );
    expect(out).toBe("<button>View rubric</button>Session expired");
  });

  it("drops popover / popovertarget / popovertargetaction", () => {
    const out = sanitizeBrief('<button popovertarget="p" popovertargetaction="show">Open</button><div popover="manual" id="p">pop</div>');
    expect(out).toBe('<button>Open</button><div id="brief-p">pop</div>');
  });
});

describe("sanitizeBrief: links (<a> and <area>)", () => {
  it("outbound links: authored target/rel are replaced by target=_blank rel=noopener noreferrer", () => {
    expect(sanitizeBrief('<a href="https://canvas.test/files/1">file</a>')).toBe(`<a href="https://canvas.test/files/1" ${EXT}>file</a>`);
    expect(sanitizeBrief('<a href="https://ok.test" rel="opener" target="pwn">a</a>')).toBe(`<a href="https://ok.test" ${EXT}>a</a>`);
    expect(sanitizeBrief('<a href="mailto:t@school.test" target="_self">mail</a>')).toBe(`<a href="mailto:t@school.test" ${EXT}>mail</a>`);
  });

  it("<area> gets the same treatment (no reverse tabnabbing via image maps)", () => {
    expect(sanitizeBrief('<map name="m"><area shape="default" href="https://evil.test/" target="_blank" rel="opener"></map>')).toBe(
      `<map name="brief-m"><area shape="default" href="https://evil.test/" ${EXT} /></map>`
    );
    expect(sanitizeBrief('<map name="m"><area href="#y" target="pwn" rel="opener"><area href="javascript:alert(1)" target="x"></map>')).toBe(
      '<map name="brief-m"><area href="#brief-y" /><area /></map>'
    );
  });

  it("in-page #anchor links and bare <a> get NO target/rel (authored ones removed); anchors still resolve", () => {
    const out = sanitizeBrief(
      '<a href="#part-2" target="pwn" rel="opener">jump</a><h2 id="part-2">Part 2</h2><a name="top"></a><a href="#top">top</a><a target="x">bare</a><a href="#">hash</a>'
    );
    expect(out).not.toMatch(/target=|rel=/);
    expect(out).toContain('<a href="#brief-part-2">jump</a><h2 id="brief-part-2">Part 2</h2>');
    expect(out).toContain('<a name="brief-top"></a><a href="#brief-top">top</a>');
    expect(out).toContain("<a>bare</a>");
    expect(out).toContain('<a href="#">hash</a>');
  });

  it("whitespace/control chars before '#' can't earn target=_blank", () => {
    expect(sanitizeBrief('<a href="  #x">a</a>')).toBe('<a href="#brief-x">a</a>');
    expect(sanitizeBrief('<a href="&#x09;#x">a</a>')).toBe('<a href="#brief-x">a</a>');
    expect(sanitizeBrief(`<a href="${String.fromCharCode(0)}#x">a</a>`)).toBe('<a href="#brief-x">a</a>');
  });

  it("protocol-relative hrefs are dropped, with or without a Canvas host", () => {
    for (const href of ["//evil.test", "\\\\evil.test", "/\\evil.test", "\\/evil.test"]) {
      expect(sanitizeBrief(`<a href="${href}">a</a>`), href).toBe("<a>a</a>");
      expect(sanitizeBrief(`<a href="${href}">a</a>`, HOST), href).toBe("<a>a</a>");
    }
  });

  it("relative links resolve against the student's Canvas host; without one they are dropped", () => {
    expect(sanitizeBrief('<a href="/courses/1/pages/intro">p</a>', HOST)).toBe(`<a href="https://${HOST}/courses/1/pages/intro" ${EXT}>p</a>`);
    expect(sanitizeBrief('<a href="files/2?x=1">f</a>', HOST)).toBe(`<a href="https://${HOST}/files/2?x=1" ${EXT}>f</a>`);
    expect(sanitizeBrief('<a href="/api/auth/signout">x</a>')).toBe("<a>x</a>");
    // a malformed host is ignored (treated as unknown), never used to build a URL
    for (const bad of ["evil.test/path", "a b", "https://x.test", "", "..", "x.test:99999999"]) {
      expect(sanitizeBrief('<a href="/courses/1">p</a>', bad), bad).toBe("<a>p</a>");
    }
  });
});

describe("sanitizeBrief: ids are namespaced (DOM clobbering)", () => {
  it("an id/name that would shadow a page global is prefixed", () => {
    expect(sanitizeBrief('<div id="__next_f">x</div><img name="cookie" src="https://x.test/a.png"><label for="email">e</label>')).toBe(
      '<div id="brief-__next_f">x</div><img name="brief-cookie" src="https://x.test/a.png" /><label for="brief-email">e</label>'
    );
  });

  it("every id-reference attribute is prefixed, incl. aria-details/-errormessage/-flowto", () => {
    const out = sanitizeBrief(
      '<div aria-labelledby="a" aria-describedby="b" aria-controls="c" aria-owns="d" aria-activedescendant="e" aria-details="f" aria-errormessage="g" aria-flowto="h i">x</div>'
    );
    expect(out).toBe(
      '<div aria-labelledby="brief-a" aria-describedby="brief-b" aria-controls="brief-c" aria-owns="brief-d" aria-activedescendant="brief-e" aria-details="brief-f" aria-errormessage="brief-g" aria-flowto="brief-h brief-i">x</div>'
    );
  });
});

describe("sanitizeBrief: images", () => {
  it("keep absolute http(s) src", () => {
    expect(sanitizeBrief('<img src="https://canvas.test/a.png" alt="diagram" width="300">')).toBe('<img src="https://canvas.test/a.png" alt="diagram" width="300" />');
    expect(sanitizeBrief('<img src="http://canvas.test/a.png">')).toBe('<img src="http://canvas.test/a.png" />');
  });

  it("lose javascript:, protocol-relative and non-image data: src; srcset is dropped", () => {
    for (const src of ["javascript:alert(1)", "//evil.test/a.png", "data:text/html,<script>alert(1)</script>"]) {
      expect(sanitizeBrief(`<img src="${src}">`, HOST), src).toBe("<img />");
    }
    expect(sanitizeBrief('<img src="https://x.test/a.png" srcset="javascript:alert(1) 1x">')).toBe('<img src="https://x.test/a.png" />');
  });

  it("relative src resolves against the Canvas host, else is dropped", () => {
    expect(sanitizeBrief('<img src="/courses/1/files/2/preview">', HOST)).toBe(`<img src="https://${HOST}/courses/1/files/2/preview" />`);
    expect(sanitizeBrief('<img src="/courses/1/files/2/preview">')).toBe("<img />");
  });

  it("allow data:image/ src, incl. svg+xml (scripts never run in an <img>)", () => {
    expect(sanitizeBrief('<img src="data:image/png;base64,iVBORw0KGgo=">')).toBe('<img src="data:image/png;base64,iVBORw0KGgo=" />');
    expect(sanitizeBrief('<img src="data:image/svg+xml,<svg onload=alert(1)>">')).toBe('<img src="data:image/svg+xml,&lt;svg onload=alert(1)&gt;" />');
  });
});

describe("sanitizeBrief: normal brief formatting survives", () => {
  it("tables, lists, headings, strong/em, code/pre", () => {
    const html =
      "<h1>Essay</h1><h2>Parts</h2><p>Write <strong>two</strong> pages, <em>double</em> spaced.</p>" +
      "<ul><li>Intro</li><li>Body</li></ul><ol><li>Draft</li><li>Revise</li></ol>" +
      '<table border="1"><thead><tr><th>Part</th><th>Points</th></tr></thead><tbody><tr><td colspan="1">Essay</td><td>50</td></tr></tbody></table>' +
      "<pre><code>x &lt; y &amp;&amp; y &gt; z</code></pre>";
    expect(sanitizeBrief(html)).toBe(html);
  });

  it("keeps data-* and aria-* attributes", () => {
    expect(sanitizeBrief('<p data-id="7" aria-label="note">x</p>')).toBe('<p data-id="7" aria-label="note">x</p>');
  });
});

describe("sanitizeBrief: Canvas screen-reader-only helpers are removed (#140)", () => {
  // Canvas's real external-link markup: the link text, then a decorative icon
  // wrapper holding an SVG and hidden text for screen readers.
  const CANVAS_LINK =
    '<a class="external" href="https://example.test/syllabus" target="_blank"><span>Syllabus</span>' +
    '<span class="external_link_icon" style="margin-inline-start: 5px; display: inline-block;" role="presentation">' +
    '<svg viewBox="0 0 1920 1920"><path d="M1226 0v112"></path></svg>' +
    '<span class="screenreader-only">Links to an external site.</span></span></a>';

  it("an external link keeps its text but loses the glued-on 'Links to an external site.'", () => {
    const out = sanitizeBrief(`<p>Read the ${CANVAS_LINK} first.</p>`, HOST);
    expect(out).toBe(`<p>Read the <a href="https://example.test/syllabus" ${EXT}><span>Syllabus</span></a> first.</p>`);
    expect(out).not.toContain("Links to an external site");
  });

  it("a bare screenreader-only span is dropped with its text, even without the icon wrapper", () => {
    expect(sanitizeBrief('<a href="https://x.test">Rubric<span class="screenreader-only">Links to an external site.</span></a>')).toBe(
      `<a href="https://x.test" ${EXT}>Rubric</a>`
    );
  });

  it("only Canvas's own helper SPANS are dropped (screenreader-only, ui-helper-hidden-accessible, external_link_icon)", () => {
    for (const cls of ["screenreader-only", "ui-helper-hidden-accessible", "external_link_icon", "Screenreader-Only"]) {
      expect(sanitizeBrief(`<p>a<span class="x ${cls} y">Links to an external site.</span>b</p>`), cls).toBe("<p>ab</p>");
    }
  });

  it("a teacher's own sr-only / visually-hidden text is kept (not Canvas classes)", () => {
    expect(sanitizeBrief('<p>Read <span class="sr-only">chapter 4</span> and <span class="visually-hidden">5</span>.</p>')).toBe(
      "<p>Read <span>chapter 4</span> and <span>5</span>.</p>"
    );
  });

  it("a Canvas class on a non-span (div, p) is kept", () => {
    expect(sanitizeBrief('<div class="screenreader-only"><p>Write 500 words.</p></div>')).toBe("<div><p>Write 500 words.</p></div>");
  });

  // The #140 review's three probes.
  it("probe 1 — a helper class wrapping the whole brief does not delete the brief", () => {
    const brief = '<span class="screenreader-only"><h2>Essay 2</h2><p>Write 500 words on the reading.</p><ul><li>Cite two sources</li></ul></span>';
    expect(sanitizeBrief(brief)).toBe("<span><h2>Essay 2</h2><p>Write 500 words on the reading.</p><ul><li>Cite two sources</li></ul></span>");
    expect(sanitizeBrief('<span class="sr-only"><p>Whole brief here.</p></span>')).toBe("<span><p>Whole brief here.</p></span>");
  });

  it("probe 2 — an unclosed helper span can't swallow the rest of the brief", () => {
    expect(sanitizeBrief('<p>Intro<span class="screenreader-only">Links to an external site.</p><p>Rest of the brief.</p><p>Due Friday.</p>')).toContain(
      "<p>Rest of the brief.</p><p>Due Friday.</p>"
    );
    expect(sanitizeBrief('<p>Intro <span class="sr-only">note</p><p>Rest of the brief.</p>')).toContain("<p>Rest of the brief.</p>");
    const tail = "Then answer all six questions on the worksheet and bring it to class. ".repeat(3);
    expect(sanitizeBrief(`<span class="screenreader-only">${tail}`)).toContain("Then answer all six questions");
  });

  it("probe 3 — nested inside a link, only the helper goes; the link and its text stay", () => {
    expect(sanitizeBrief(`<ul><li>${CANVAS_LINK}</li></ul>`)).toBe(`<ul><li><a href="https://example.test/syllabus" ${EXT}><span>Syllabus</span></a></li></ul>`);
  });

  it("look-alike classes are NOT stripped and class is still never output", () => {
    expect(sanitizeBrief('<span class="screenreader-onlyish">keep</span><span class="only">me</span>')).toBe("<span>keep</span><span>me</span>");
  });

  it("the strip only removes output: dangerous content next to it is still sanitized", () => {
    const out = sanitizeBrief('<span class="screenreader-only">x</span><img src="https://x.test/a.png" onerror="alert(1)"><a href="javascript:alert(1)">go</a>');
    expect(out).toBe('<img src="https://x.test/a.png" /><a>go</a>');
  });
});

describe("sanitizeBrief: never throws, bounded work", () => {
  it("malformed / unclosed input", () => {
    expect(() => sanitizeBrief('<div><p>unclosed <b>bold <a href="https://x')).not.toThrow();
    expect(sanitizeBrief('<div><p>unclosed <b>bold <a href="https://x')).toBe("<div><p>unclosed <b>bold </b></p></div>");
    expect(() => sanitizeBrief("</p></div><<<>>>&&&<!-- <script>")).not.toThrow();
    expect(sanitizeBrief("</p></div><<<>>>&&&<!-- <script>")).not.toMatch(/<script/);
  });

  it("empty and non-string input -> empty string", () => {
    expect(sanitizeBrief("")).toBe("");
    expect(sanitizeBrief(null as unknown as string)).toBe("");
    expect(sanitizeBrief(undefined as unknown as string)).toBe("");
    expect(sanitizeBrief(42 as unknown as string)).toBe("");
  });

  it("input is capped at MAX_BRIEF_CHARS (200k)", () => {
    expect(MAX_BRIEF_CHARS).toBe(200_000);
    const out = sanitizeBrief("<p>" + "a".repeat(1_000_000) + "</p>");
    expect(out.length).toBeLessThanOrEqual(MAX_BRIEF_CHARS + "</p>".length);
    expect(out.startsWith("<p>aaa")).toBe(true);
  });

  it("a large but realistic brief (5,000 tags) is not truncated by the tag cap", () => {
    const html = "<p>line</p>".repeat(2_500);
    expect(sanitizeBrief(html)).toBe(html);
  });

  it("time budget: 200k nested tags (and 100k nested divs) sanitize in well under a second", () => {
    for (const [tag, n] of [["b", 200_000], ["div", 100_000]] as const) {
      const t0 = performance.now();
      const out = sanitizeBrief(`<${tag}>`.repeat(n) + "x");
      const ms = performance.now() - t0;
      expect(ms).toBeLessThan(1000);
      // nesting is bounded too: deeper tags are unwrapped
      expect((out.match(new RegExp(`<${tag}>`, "g")) ?? []).length).toBeLessThanOrEqual(200);
    }
  });
});

// --- source guards: server sanitizes, client renders, DOMPurify stays out ---
const ROOT = resolve(__dirname, "..");
const read = (...p: string[]) => readFileSync(resolve(ROOT, ...p), "utf8");

/** Every `useEffect(...)` call's full argument text (paren-matched). */
function useEffectBodies(src: string): string[] {
  const bodies: string[] = [];
  let from = 0;
  for (;;) {
    const i = src.indexOf("useEffect(", from);
    if (i < 0) return bodies;
    let depth = 0;
    let j = i + "useEffect".length;
    for (; j < src.length; j++) {
      if (src[j] === "(") depth++;
      else if (src[j] === ")" && --depth === 0) break;
    }
    bodies.push(src.slice(i, j + 1));
    from = j + 1;
  }
}

describe("assignment brief is sanitized on the server, rendered on first paint", () => {
  const component = read("components", "AssignmentPage.tsx");
  const page = read("app", "(app)", "assignment", "[id]", "page.tsx");

  it("AssignmentPage no longer imports dompurify or sanitizes in a useEffect", () => {
    expect(component).not.toMatch(/dompurify/i);
    expect(component).not.toMatch(/setSafeHtml|htmlToText|sanitizeBrief\(/);
    expect(component).not.toMatch(/from\s+["']@\/lib\/(sanitizeBrief|htmlText)["']/); // server-only work stays on the server
    for (const body of useEffectBodies(component)) {
      expect(body).not.toMatch(/safeHtml|description|sanitiz/i);
    }
    expect(component).toMatch(/safeHtml: string \| null;/);
    expect(component).toMatch(/dangerouslySetInnerHTML=\{\{\s*__html:\s*safeHtml\s*\}\}/);
  });

  it("the brief wrapper clips its content (backstop against page-covering styles)", () => {
    const m = component.match(/className="(brief\b[^"]*)"/);
    expect(m).not.toBeNull();
    const t = new Set(m![1].split(/\s+/));
    for (const c of ["relative", "overflow-hidden", "[contain:layout_paint]"]) expect(t.has(c), c).toBe(true);
  });

  it("the server page sanitizes with the Canvas host and never passes raw HTML down", () => {
    expect(page).toMatch(/import\s*\{\s*sanitizeBrief\s*\}\s*from\s*["']@\/lib\/sanitizeBrief["']/);
    expect(page).toMatch(/sanitizeBrief\(a\.description,\s*cred\?\.host \?\? null\)/);
    expect(page).toMatch(/select:\s*\{\s*host:\s*true\s*\}/); // host only — never the token
    expect(page).toMatch(/safeHtml=\{safeHtml\}/);
    expect(page).not.toMatch(/description=\{/);
  });

  it("sync caps the stored description at the same MAX_BRIEF_CHARS", () => {
    const sync = read("lib", "sync.ts");
    expect(sync).toMatch(/import\s*\{\s*MAX_BRIEF_CHARS\s*\}\s*from\s*["']\.\/limits["']/);
    expect(sync).toMatch(/description:\s*typeof a\.description === "string" \? a\.description\.slice\(0, MAX_BRIEF_CHARS\) : null/);
  });

  it("jsdom and isomorphic-dompurify are absent from the lockfile", () => {
    const lock = JSON.parse(read("package-lock.json")) as { packages: Record<string, unknown> };
    const paths = Object.keys(lock.packages).filter((k) => /(^|\/)node_modules\/(jsdom|isomorphic-dompurify|dompurify)$/.test(k));
    expect(paths).toEqual([]);
  });
});
