// Pure, dependency-free HTML → plain-text reduction. Used as the pre-hydration
// fallback for the Canvas assignment brief: the server can't sanitize HTML (no
// DOM there), so until DOMPurify runs in the browser we show the brief as text.
// React escapes the result, so whatever Canvas sent is inert in this form.
//
// Whitespace model (mirrors how a browser lays the HTML out):
//   - source whitespace, incl. newlines, is just whitespace → collapses to a space
//   - any run of block boundaries (</p>, </li>, <ul>, </tr>, …) → ONE newline
//     (so "</p><ul>" or a nested "</li></ul></li>" never leaves a blank line)
//   - each <br> → one newline, so "<br><br>" is a deliberate blank line
//   - </td> and </th> → a space, so table cells never run together

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

// Attribute-value-aware pieces: tolerate ">" inside quoted attribute values.
const ATTRS = `(?:[^>"']|"[^"]*"|'[^']*')*`;
const TAG = new RegExp(`<${ATTRS}>`, "g");
const LIST_OR_TABLE_OPEN = new RegExp(`<(?:ul|ol|table)\\b${ATTRS}>`, "gi");

// Internal markers for structure; stripped from the input first so a brief
// can't smuggle them in.
const BLOCK = "";
const LINE = "";

function decodeEntity(match: string, name: string): string {
  if (name[0] === "#") {
    const hex = name[1] === "x" || name[1] === "X";
    const code = parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
    // Control characters (other than tab/newline) have no business in prose —
    // and must never collide with the markers above.
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return "";
    try {
      return String.fromCodePoint(code);
    } catch {
      return match;
    }
  }
  return NAMED_ENTITIES[name] ?? match;
}

export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  let s = String(html).replace(/[]/g, "");
  // Comments and whole script/style blocks go first (content included) so
  // nothing inside them survives as visible text.
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  // Structure → markers.
  s = s.replace(/<br\s*\/?>/gi, LINE);
  s = s.replace(/<\/(td|th)\s*>/gi, " ");
  s = s.replace(LIST_OR_TABLE_OPEN, BLOCK);
  s = s.replace(/<\/(p|li|div|h[1-6]|tr|blockquote|pre)\s*>/gi, BLOCK);
  // Strip every remaining tag, THEN decode entities so "&lt;b&gt;" stays text.
  s = s.replace(TAG, "");
  s = s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, decodeEntity);
  // Whitespace (incl. source newlines and nbsp) → single space.
  s = s.replace(/\s+/g, " ");
  // A run of block boundaries → one newline; each <br> → one newline.
  s = s.replace(/ *[ ]*/g, "\n");
  s = s.replace(/ * */g, "\n");
  // Cap blank lines at one (only reachable via repeated <br>).
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}
