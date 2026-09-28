// Course-name display helpers, shared across the dashboard, plan, course, and
// study surfaces so the same class always renders the same way (one place to fix
// if Canvas changes its course-code format).

// A Canvas term code: "2025F-10", "2026SP-01", "2026F-01A" — the section is
// digits plus at most one letter. Cross-listed sections chain more codes or bare
// section numbers with "/", "," or "&" ("2026F-01/02:", "2026F-01 & 2026F-03:").
// Optional space before the colon. Deliberately strict: a real title that merely
// looks code-ish ("2020s-Era: …", "2026F-01 / Honors: …") is left alone.
const SECTION = String.raw`\d+[A-Za-z]?`;
const CODE = String.raw`\d{4}[A-Za-z]{1,4}-${SECTION}`;
const CODE_PREFIX = new RegExp(String.raw`^\s*${CODE}(?:\s*[/,&]\s*(?:${CODE}|${SECTION}))*\s*:\s*`);

/** Strip a Canvas course-code prefix like "2025F-10: " → just the readable name. */
export const cleanCourse = (name: string): string => name.replace(CODE_PREFIX, "").trim() || name;

/** First segment of a " · "-joined course label, with the Canvas code prefix
 *  stripped — so every surface shows the readable class name, not "2025F-05:…". */
export const shortCourse = (name: string): string => cleanCourse(name.split(" · ")[0]);
