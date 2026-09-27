// #131: the Canvas assignment brief is sanitized on the SERVER (lib/sanitizeBrief,
// sanitize-html — htmlparser2-based, no DOM) so the first paint is formatted with
// no text-then-HTML swap. History: isomorphic-dompurify pulled jsdom into the
// Vercel bundle and 500'd every /assignment/[id]; browser-side dompurify (#130)
// fixed that but flickered. These guards keep jsdom and dompurify out of the tree
// and make sure the raw `description` never reaches dangerouslySetInnerHTML.
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");
const PAGE = resolve(ROOT, "app", "(app)", "assignment", "[id]", "page.tsx");
const COMPONENT = resolve(ROOT, "components", "AssignmentPage.tsx");
const PACKAGE_JSON = resolve(ROOT, "package.json");
const read = (f: string) => readFileSync(f, "utf8");

describe("assignment brief is sanitized on the server (lib/sanitizeBrief), never with a DOM", () => {
  it("the server page sanitizes via lib/sanitizeBrief and passes only safeHtml down", () => {
    const src = read(PAGE);
    expect(src).toMatch(/from\s+["']@\/lib\/sanitizeBrief["']/);
    expect(src).toMatch(/sanitizeBrief\(/);
    expect(src).toMatch(/safeHtml=/);
    expect(src).not.toMatch(/dompurify/i);
  });
  it("the client component no longer imports dompurify or sanitizes in an effect", () => {
    const src = read(COMPONENT);
    expect(src).toMatch(/^"use client";/);
    expect(src).not.toMatch(/dompurify/i);
    expect(src).not.toMatch(/setSafeHtml|isSupported/);
  });
  it("exactly one dangerouslySetInnerHTML, fed by safeHtml and never by the raw `description`", () => {
    const src = read(COMPONENT);
    const uses = src.match(/dangerouslySetInnerHTML/g) ?? [];
    expect(uses).toHaveLength(1);
    const m = src.match(/dangerouslySetInnerHTML=\{\{\s*__html:\s*([^}]*)\}\}/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/\bsafeHtml\b/);
    expect(m![1]).not.toMatch(/\bdescription\b/);
  });
  it("package.json: sanitize-html pinned exactly; no dompurify, isomorphic-dompurify or jsdom", () => {
    const pkg = JSON.parse(read(PACKAGE_JSON)) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = pkg.dependencies ?? {};
    expect(deps["sanitize-html"]).toMatch(/^\d+\.\d+\.\d+$/); // exact pin, no ^ or ~
    expect(deps["isomorphic-dompurify"]).toBeUndefined();
    expect(deps["dompurify"]).toBeUndefined();
    expect(deps["jsdom"]).toBeUndefined();
    expect((pkg.devDependencies ?? {})["jsdom"]).toBeUndefined();
  });
});
