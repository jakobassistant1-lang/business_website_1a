// Ticket #146 — the owner's wording canon (2026-09-28), guarded in every string a
// student can read: app/ and components/ (admin-only surfaces excepted) plus the
// user-facing string modules in lib/. Only USER-FACING text is checked — string
// literals, template text and JSX text, parsed with the TypeScript compiler so
// identifiers, comments, imports, type unions, object keys, URLs/paths and
// non-copy JSX attributes (className, href, data-*, …) never trip a rule.
//
// When a rule fires: use the canon word (the message says which). When the hit
// is genuinely not copy, add it to ALLOW below with a one-line reason.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import * as ts from "typescript";

const ADMIN_ONLY = [
  "app/(app)/admin/",
  "app/admin/",
  "app/api/admin/",
  "components/KanbanBoard.tsx",
  "components/BurndownChart.tsx",
  "components/StandupLog.tsx",
  "components/AiSettingsForm.tsx",
  "components/StudyPromptsSettings.tsx",
  "components/Hierarchy",
];

/** lib modules whose strings reach students verbatim (UI copy, emails, the tour,
 *  rationale lines, the sync result message). */
const LIB_COPY = [
  "lib/messages.ts",
  "lib/syncReport.ts",
  "lib/welcomeEmail.ts",
  "lib/trialEndingEmail.ts",
  "lib/subscription.ts",
  "lib/tour/demoTour.ts",
  "lib/trialTerms.ts",
  "lib/pendingDone.ts",
  "lib/courseCounts.ts",
  "lib/planFocus.ts",
  "lib/rankActive.ts",
  "lib/carousel.ts",
  "lib/gradeCalc.ts",
  "lib/priority.ts",
  "lib/sync.ts",
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : [];
  });
}

const FILES = [...walk("app"), ...walk("components"), ...LIB_COPY]
  .map((f) => f.split("\\").join("/"))
  .filter((f) => !ADMIN_ONLY.some((a) => f.startsWith(a)));

/** JSX attributes that carry code, not copy. */
const CODE_ATTRS = new Set([
  "className", "href", "id", "key", "htmlFor", "rel", "target", "type", "role", "src", "method", "style",
  "inputMode", "autoComplete", "autoCapitalize", "autoCorrect", "name", "pattern", "accept", "viewBox", "d",
  "fill", "stroke", "strokeWidth", "strokeLinecap", "strokeLinejoin", "format", "side", "tone", "kind",
  "aria-controls", "aria-labelledby", "aria-describedby", "aria-hidden", "aria-live", "aria-current",
]);

/** Attributes read ALOUD by screen readers (or shown as a tooltip): durations
 *  there are spelled out ("about 3 hours"), so the compact-duration rule skips them. */
const SPOKEN_ATTRS = new Set(["aria-label", "title"]);

/** Identifier SHAPES — never copy. Everything else is scanned, including a bare
 *  lowercase word ("classes" in `{n === 1 ? "class" : "classes"}` is copy). */
const IDENTIFIER_SHAPES: RegExp[] = [
  /^[a-z0-9]+(-[a-z0-9]+)+$/, // kebab: data-tour ids, css tokens
  /^[a-z]+[a-z0-9]*([A-Z][a-z0-9]*)+$/, // camelCase
  /^[a-z0-9]+(_[a-z0-9]+)+$/, // snake_case (status codes, funnel events)
  /^[a-z0-9]+([.:][a-z0-9_-]+)+$/, // dotted / namespaced ids ("sp:demo-answered")
  /^(\/|https?:|mailto:|#|@)/, // paths, URLs, anchors, aliases
  /^[a-z]+\/[a-z0-9.+-]+$/, // content types
];

type Text = { file: string; line: number; text: string; attr: string | null };

/** Is this literal a code token by POSITION: an equality operand, a switch
 *  case, an element-access key, or a single-word argument to a state setter
 *  like setStage("sync")? Only bare single words qualify — a sentence in the
 *  same position is still copy. */
function codePosition(n: ts.Node, text: string): boolean {
  if (!/^[a-z]+$/.test(text)) return false;
  const p = n.parent;
  if (!p) return false;
  if (ts.isBinaryExpression(p)) {
    const k = p.operatorToken.kind;
    return k === ts.SyntaxKind.EqualsEqualsEqualsToken || k === ts.SyntaxKind.ExclamationEqualsEqualsToken || k === ts.SyntaxKind.EqualsEqualsToken || k === ts.SyntaxKind.ExclamationEqualsToken;
  }
  if (ts.isCaseClause(p) || ts.isElementAccessExpression(p)) return true;
  if (ts.isCallExpression(p)) return /^(set[A-Z]\w*|useState|.*\.(get|has|includes|startsWith|endsWith|indexOf)|typeof)$/.test(p.expression.getText());
  return false;
}

/** Every user-facing text in a source file. Exported shape for the self-test. */
function userTextOf(file: string, src: string): Text[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Text[] = [];
  const attrOf = (n: ts.Node): string | null => {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) if (ts.isJsxAttribute(p)) return p.name.getText();
    return null;
  };
  const push = (n: ts.Node, text: string) => {
    // An object property named like a code attribute ({ id: "…", "aria-labelledby": `…` }) is code too.
    const prop = n.parent && ts.isPropertyAssignment(n.parent) && n.parent.initializer === n ? n.parent.name.getText().replace(/^["']|["']$/g, "") : null;
    if (prop && (CODE_ATTRS.has(prop) || prop.startsWith("data-"))) return;
    const attr = attrOf(n);
    if (attr && (CODE_ATTRS.has(attr) || attr.startsWith("data-"))) return;
    out.push({ file, line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, text, attr });
  };
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isLiteralTypeNode(n)) return;
    if (ts.isCallExpression(n) && /^console\.|^fetch$|^require$/.test(n.expression.getText())) return;
    if (ts.isTemplateExpression(n)) {
      push(n, n.head.text + n.templateSpans.map((s) => "{}" + s.literal.text).join(""));
      for (const span of n.templateSpans) visit(span.expression); // copy inside a hole is still copy
      return;
    }
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      const isKey = n.parent && (ts.isPropertyAssignment(n.parent) || ts.isPropertySignature(n.parent)) && n.parent.name === n;
      if (!isKey && !codePosition(n, n.text)) push(n, n.text);
    } else if (n.kind === ts.SyntaxKind.JsxText) {
      push(n, n.getText());
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out
    .map((t) => ({ ...t, text: t.text.replace(/\s+/g, " ").trim() }))
    .filter((t) => t.text.length > 0)
    .filter((t) => !IDENTIFIER_SHAPES.some((re) => re.test(t.text)));
}

const userText = (file: string) => userTextOf(file, readFileSync(file, "utf8"));

const TEXTS = FILES.flatMap(userText);

/** Rules that don't apply to text read aloud (aria-label / title). */
const NOT_FOR_SPOKEN = new Set(["duration words"]);

// [rule, pattern, canon]
const RULES: [string, RegExp, string][] = [
  ["class/classes", /\bclass(es)?\b/i, 'say "course" / "courses"'],
  ["overdue", /\boverdue\b/i, 'say "Past due"'],
  ["at risk", /\bat risk\b/i, 'say "Past due"'],
  ["study block", /\bstudy blocks?\b|\bscheduled study\b|\bstudy booked\b/i, 'say "study session(s)" / "Study session booked"'],
  ["sign in", /\bsign(ed|ing)?[ -]?in\b/i, 'say "Log in" / "Logging in…"'],
  ["sync button", /\b[Ss]ync now\b|^(Sync|Refresh)$/, 'say "Check Canvas now" (Google: "Check Google now")'],
  ["completed", /\bcompleted\b/i, 'the section is "Done"'],
  ["old Focus names", /\bnext up\b|\bdo in this order\b|\brecommended order\b|\bdo-next\b|^do next$/i, 'say "Focus" / "in Focus order"'],
  ["no date", /\bno date\b/i, 'say "No due date"'],
  ["three dots", /\.\.\./, 'use "…"'],
  ["appended arrow", /\S\s*[→↗]$/, "no →/↗ after link or button text (use an icon component)"],
  ["hedging", /\b(may|might|probably)\b/, "state the fact"],
  ["duration words", /\d\s*(hrs?|hours?|mins?|minutes?)\b|\{\}\s*(hrs?|hours?|mins?|minutes?)\b/i, 'use the effort formatter ("~2h", "45m")'],
  ["price fallback", /small monthly fee|monthly plan price|free week/i, "use PRICE_FALLBACK / TRIAL_DAYS"],
  ["plan = subscription", /keep (my|your) plan|your plan (ends|may)/i, '"plan" is the study plan; say "subscription"'],
  ["straight apostrophe", /[A-Za-z]('|&apos;)[A-Za-z]/, "use a curly apostrophe (’)"],
];

/** Documented exceptions: [file, rule, substring of the text, reason]. */
const ALLOW: [file: string, rule: string, text: string, reason: string][] = [
  ["lib/planFocus.ts", "old Focus names", "Do next", 'the Plan GROUP name — a group of rows, owner-approved (not the #1 item)'],
  ["app/api/auth/login/route.ts", "duration words", "Try again in {} minutes", "a lockout wait time, not an effort/duration estimate"],
  ["app/api/assignment/effort/route.ts", "duration words", "between 15 minutes and 20 hours", "a validation range, spelled out so it reads as a sentence (coordinator review)"],
  ["app/api/auth/forgot-password/route.ts", "duration words", "expires in 1 hour", "a link's expiry in an email sentence, not an effort estimate"],
  ["components/ForgotPasswordForm.tsx", "duration words", "expires in 1 hour", "the same reset-link expiry, echoed on screen"],
];

describe("wording canon (#146): no banned words in student-facing strings", () => {
  it("scans the student-facing sources", () => {
    expect(FILES.length).toBeGreaterThan(100);
    expect(TEXTS.length).toBeGreaterThan(1000);
    for (const f of LIB_COPY) expect(FILES).toContain(f);
  });
  for (const [rule, re, canon] of RULES) {
    it(`${rule} → ${canon}`, () => {
      const hits = TEXTS.filter((t) => re.test(t.text))
        .filter((t) => !(NOT_FOR_SPOKEN.has(rule) && t.attr && SPOKEN_ATTRS.has(t.attr)))
        .filter((t) => !ALLOW.some(([f, r, s]) => f === t.file && r === rule && t.text.includes(s)))
        .map((t) => `${t.file}:${t.line}  ${t.text.slice(0, 120)}`);
      expect(hits, `${rule}: ${canon}`).toEqual([]);
    });
  }
  it("every allowlist entry still matches something (no stale exceptions)", () => {
    for (const [f, rule, s] of ALLOW) {
      const re = RULES.find(([r]) => r === rule)![1];
      expect(TEXTS.some((t) => t.file === f && t.text.includes(s) && re.test(t.text)), `${f} ${rule} ${s}`).toBe(true);
    }
  });
});

describe("the scanner sees copy and ignores code", () => {
  const FIXTURE = `
    const a = n === 1 ? "class" : "classes";
    if (status === "overdue") setStage("sync");
    const b = <p className="min-w-0" data-tour="dash-focus" aria-label={\`about \${n} hours\`}>{\`\${n} \${n === 1 ? "class" : "classes"}\`}</p>;
  `;
  const fx = userTextOf("fixture.tsx", FIXTURE).map((t) => t.text);
  it("self-test: a bare lowercase \"classes\" is copy and gets caught — also inside a template hole", () => {
    expect(fx.filter((t) => t === "classes")).toHaveLength(2);
    expect(fx.filter((t) => t === "class")).toHaveLength(2);
    expect(fx.some((t) => /\bclass(es)?\b/i.test(t))).toBe(true);
  });
  it("self-test: comparisons, setter tokens, classNames and data-* stay out", () => {
    expect(fx).not.toContain("overdue");
    expect(fx).not.toContain("sync");
    expect(fx).not.toContain("min-w-0");
    expect(fx).not.toContain("dash-focus");
  });
  it("self-test: aria-label text is kept, tagged as spoken", () => {
    const spoken = userTextOf("fixture.tsx", FIXTURE).find((t) => t.text.startsWith("about"));
    expect(spoken?.attr).toBe("aria-label");
  });
  const texts = (f: string) => TEXTS.filter((t) => t.file === f).map((t) => t.text);
  it("finds JSX text, attribute copy and module strings", () => {
    expect(texts("components/navItems.ts")).toContain("Courses");
    expect(texts("components/SyncStatus.tsx")).toContain("Check Canvas now");
    expect(texts("lib/messages.ts")).toContain("Navo couldn’t finish that. Try again.");
  });
  it("skips status identifiers, classNames and paths", () => {
    const all = TEXTS.map((t) => t.text);
    expect(all).not.toContain("overdue");
    expect(all.some((t) => t.startsWith("/class/"))).toBe(false);
    expect(all.some((t) => /\bmin-w-0\b/.test(t))).toBe(false);
  });
});

describe("shared state wordings live in lib/messages (one per state)", () => {
  const read = (f: string) => readFileSync(f, "utf8");
  it("a Navo 5xx never blames the student's connection", async () => {
    const { NETWORK_ERROR, SERVER_ERROR } = await import("@/lib/messages");
    expect(SERVER_ERROR).toBe("Navo couldn’t finish that. Try again.");
    expect(SERVER_ERROR).not.toMatch(/connection/i);
    expect(NETWORK_ERROR).toMatch(/connection/i);
    const tools = read("components/StudyTools.tsx");
    expect(tools).toContain('if (json === null && res.status >= 500) return { ok: false, error: "server" };');
    expect(tools).toContain("server: SERVER_ERROR,");
  });
  it("NotesSection uses the shared network line in all three maps", () => {
    const src = read("components/NotesSection.tsx");
    expect(src.match(/network: NETWORK_ERROR,/g)).toHaveLength(3);
    expect(src).not.toContain("Couldn’t reach the server");
  });
  it("ONE price fallback, from lib/messages, on every surface that only describes the price", async () => {
    const { PRICE_FALLBACK } = await import("@/lib/messages");
    expect(PRICE_FALLBACK).toBe("a monthly fee");
    for (const f of ["components/AuthFlow.tsx", "lib/trialEndingEmail.ts", "app/billing/canceled/page.tsx"]) {
      expect(read(f), f).toContain("PRICE_FALLBACK");
    }
  });
  it("the card page never shows the payment form without the real price", async () => {
    const { PRICE_UNAVAILABLE } = await import("@/lib/messages");
    expect(PRICE_UNAVAILABLE).toBe("We couldn’t load the price. Try again.");
    const src = read("app/welcome/card/page.tsx");
    expect(src).not.toContain("PRICE_FALLBACK");
    expect(src).toContain("const price = await priceDisplay().catch(() => null);");
    const gate = src.indexOf("{!price ? (");
    expect(gate).toBeGreaterThan(-1);
    expect(src.indexOf("{PRICE_UNAVAILABLE}")).toBeGreaterThan(gate);
    expect(src.indexOf("<CheckoutEmbed")).toBeGreaterThan(src.indexOf(") : (", gate)); // only in the has-price branch
    expect(src).toMatch(/href="\/welcome\/card"[^>]*>Try again</);
  });
  it("a failed FIRST Canvas check never promises 'last good data'", async () => {
    const { canvasCheckFailed, CANVAS_CHECK_FAILED, CANVAS_FIRST_CHECK_FAILED } = await import("@/lib/messages");
    expect(canvasCheckFailed(false)).toBe("Navo couldn’t read your courses from Canvas. Try again.");
    expect(canvasCheckFailed(true)).toBe(CANVAS_CHECK_FAILED);
    expect(CANVAS_FIRST_CHECK_FAILED).not.toMatch(/last good data/);
    const first = read("components/FirstSyncProgress.tsx");
    expect(first).toContain("setError(!msg || msg === CANVAS_CHECK_FAILED ? canvasCheckFailed(false) : msg);");
    expect(read("lib/sync.ts").match(/message: canvasCheckFailed\(prevSyncedAt !== null\)/g)).toHaveLength(2);
  });
  it("the demo button and the welcome email name the same tour length", () => {
    expect(read("components/DemoExperience.tsx")).toContain("Take the 2-minute tour");
    expect(read("lib/welcomeEmail.ts")).toContain("a 2-minute walkthrough");
  });
  it("links say where they go: /dashboard is 'your dashboard'", () => {
    for (const f of ["components/ConnectionsForm.tsx", "components/FirstSyncProgress.tsx"]) {
      const src = read(f);
      expect(src, f).not.toContain("Go to your plan");
      expect(src, f).toMatch(/href="\/dashboard"[^>]*>\s*Go to your dashboard/);
    }
  });
});
