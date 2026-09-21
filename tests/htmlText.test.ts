// Guards for the assignment-brief sanitization move (2026-09-21): the Canvas HTML
// is sanitized in the BROWSER (components/AssignmentPage via `dompurify`), never
// on the server — isomorphic-dompurify pulled jsdom into the Vercel bundle and
// 500'd every /assignment/[id]. The pure text fallback (lib/htmlText) behaves as
// specified, AND the grep guards keep jsdom out of the server bundle for good.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { htmlToText } from "@/lib/htmlText";

describe("htmlToText (pre-hydration brief fallback)", () => {
  it("strips tags but keeps their text", () => {
    expect(htmlToText("<p>Read <strong>chapter 3</strong> and <em>summarize</em>.</p>")).toBe("Read chapter 3 and summarize.");
    expect(htmlToText('<a href="https://x.test" onclick="evil()">link</a>')).toBe("link");
  });
  it("tolerates '>' inside quoted attribute values", () => {
    expect(htmlToText('<span title="x>y">shown</span>')).toBe("shown");
    expect(htmlToText("<a href='a>b' data-x=\"1>2\">link</a> after")).toBe("link after");
  });
  it("decodes the common named entities", () => {
    expect(htmlToText("Tom &amp; Jerry &lt;3 &quot;quoted&quot; it&#39;s&nbsp;here &gt;")).toBe('Tom & Jerry <3 "quoted" it\'s here >');
    expect(htmlToText("&apos;x&apos;")).toBe("'x'");
  });
  it("decodes numeric entities (decimal and hex) via code point", () => {
    expect(htmlToText("it&#8217;s &#x27;quoted&#x27; &#160;spaced &#128512;")).toBe("it’s 'quoted' spaced \u{1F600}");
    expect(htmlToText("&#8212; dash &#X2014;")).toBe("— dash —");
  });
  it("leaves unknown or malformed entities as-is", () => {
    expect(htmlToText("&bogus; &#99999999; &#; a &amp b")).toBe("&bogus; &#99999999; &#; a &amp b");
  });
  it("entity-encoded tags stay as visible text, not markup", () => {
    expect(htmlToText("&lt;script&gt;alert(1)&lt;/script&gt;")).toBe("<script>alert(1)</script>");
  });
  it("strips HTML comments, including any tags inside them", () => {
    expect(htmlToText("<p>a</p><!-- hidden <b>note</b> -->\n<p>b</p>")).toBe("a\nb");
    expect(htmlToText("<!--[if IE]><p>ie only</p><![endif]-->text")).toBe("text");
  });
  it("turns block closes and <br> into newlines", () => {
    expect(htmlToText("<p>One</p><p>Two</p>")).toBe("One\nTwo");
    expect(htmlToText("<ul><li>a</li><li>b</li></ul>")).toBe("a\nb");
    expect(htmlToText("line 1<br>line 2<br/>line 3")).toBe("line 1\nline 2\nline 3");
    expect(htmlToText("<h2>Title</h2><div>body</div>")).toBe("Title\nbody");
  });
  it("table cells are space-separated and rows are line-separated", () => {
    const table = "<table><tr><th>Part</th><th>Points</th></tr><tr><td>Essay</td><td>50</td></tr><tr><td>Quiz</td><td>20</td></tr></table>";
    expect(htmlToText(table)).toBe("Part Points\nEssay 50\nQuiz 20");
    expect(htmlToText("<p>Rubric:</p>" + table)).toBe("Rubric:\nPart Points\nEssay 50\nQuiz 20");
  });
  it("nested lists never concatenate with their parent item", () => {
    expect(htmlToText("<ul><li>Outer<ul><li>Inner 1</li><li>Inner 2</li></ul></li><li>Next</li></ul>")).toBe("Outer\nInner 1\nInner 2\nNext");
    expect(htmlToText("<p>Steps</p><ol><li>one</li></ol>")).toBe("Steps\none");
  });
  it("collapses whitespace; stacked block boundaries and empty blocks never leave blank lines", () => {
    expect(htmlToText("  a   \t b  ")).toBe("a b");
    expect(htmlToText("<p>a</p>\n\n\n<p></p><p></p><p>b</p>")).toBe("a\nb");
    expect(htmlToText("<p>Intro</p><ul><li>x</li></ul><p>Outro</p>")).toBe("Intro\nx\nOutro");
  });
  it("<br> is the one way to get a deliberate blank line, capped at one", () => {
    expect(htmlToText("a<br><br>b")).toBe("a\n\nb");
    expect(htmlToText("a<br><br><br><br>b")).toBe("a\n\nb");
  });
  it("drops <script> and <style> CONTENT, not just the tags", () => {
    expect(htmlToText('<p>safe</p><script type="text/javascript">alert("x")</script><p>after</p>')).toBe("safe\nafter");
    expect(htmlToText("<style>p{color:red}</style>text")).toBe("text");
  });
  it("empty / null-ish input → empty string", () => {
    expect(htmlToText("")).toBe("");
    expect(htmlToText(null)).toBe("");
    expect(htmlToText(undefined)).toBe("");
    expect(htmlToText("   <p>  </p>  ")).toBe("");
  });
});

// --- grep guards: keep sanitization in the browser and jsdom out of the tree ---
const ROOT = resolve(__dirname, "..");
const PAGE = resolve(ROOT, "app", "(app)", "assignment", "[id]", "page.tsx");
const COMPONENT = resolve(ROOT, "components", "AssignmentPage.tsx");
const PACKAGE_JSON = resolve(ROOT, "package.json");
const read = (f: string) => readFileSync(f, "utf8");

describe("assignment brief is sanitized in the browser, never on the server", () => {
  it("the server page imports neither isomorphic-dompurify nor dompurify", () => {
    const src = read(PAGE);
    expect(src).not.toMatch(/from\s+["']isomorphic-dompurify["']/);
    expect(src).not.toMatch(/from\s+["']dompurify["']/);
    expect(src).not.toMatch(/require\(["'](isomorphic-)?dompurify["']\)/);
  });
  it("the client component imports dompurify (not the isomorphic wrapper)", () => {
    const src = read(COMPONENT);
    expect(src).toMatch(/^"use client";/);
    expect(src).toMatch(/import\s+DOMPurify\b[^;]*from\s+["']dompurify["']/);
    expect(src).not.toMatch(/isomorphic-dompurify/);
  });
  it("exactly one dangerouslySetInnerHTML, and it is never fed by the raw `description` prop", () => {
    const src = read(COMPONENT);
    const uses = src.match(/dangerouslySetInnerHTML/g) ?? [];
    expect(uses).toHaveLength(1);
    // Pull the `__html: <expr>` expression out of that one use and make sure the
    // raw prop isn't anywhere in it.
    const m = src.match(/dangerouslySetInnerHTML=\{\{\s*__html:\s*([^}]*)\}\}/);
    expect(m).not.toBeNull();
    expect(m![1]).not.toMatch(/\bdescription\b/);
  });
  it("package.json dependencies: no isomorphic-dompurify or jsdom; dompurify pinned exactly", () => {
    const pkg = JSON.parse(read(PACKAGE_JSON)) as { dependencies?: Record<string, string> };
    const deps = pkg.dependencies ?? {};
    expect(deps["isomorphic-dompurify"]).toBeUndefined();
    expect(deps["jsdom"]).toBeUndefined();
    expect(deps["dompurify"]).toMatch(/^\d+\.\d+\.\d+$/); // exact pin, no ^ or ~
  });
});
