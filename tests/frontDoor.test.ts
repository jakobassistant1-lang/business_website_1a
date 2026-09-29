// Ticket #139 — UI audit round 1: the front door (login / signup / hidden admin
// door) and the settings forms. Grep guards, in the style of mobileForms.test.ts,
// so the fixes can't be quietly undone.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { validateAuthForm, firstInvalidField, loginFieldsInvalid } from "@/components/AuthFlow";
import { NETWORK_ERROR, TOS_REQUIRED } from "@/lib/messages";

const read = (p: string) => readFileSync(p, "utf8");

/** Every source file under a directory (node_modules/.next never live under these). */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|mdx?|json|css)$/.test(p) ? [p] : [];
  });
}

const auth = read("components/AuthFlow.tsx");
const login = read("app/login/page.tsx");
const signup = read("app/signup/page.tsx");
const settings = read("components/SettingsForm.tsx");
const account = read("components/AccountForm.tsx");
const conn = read("components/ConnectionsForm.tsx");

/** The body of one async submit handler (from `async function onSubmit(` to the next top-level `}`). */
function submitBodies(src: string): string[] {
  return [...src.matchAll(/async function onSubmit\([\s\S]*?\n {2}\}\n/g)].map((m) => m[0]);
}

describe("1 · students go straight to the form; the admin door is hidden", () => {
  it("AuthFlow has no role picker", () => {
    expect(auth).not.toMatch(/RoleCard|I'm a student|I'm an admin|Who&apos;s signing in|setRole/);
  });
  it("/login and /signup render AuthFlow without a role (the student default)", () => {
    for (const page of [login, signup]) {
      expect(page).toMatch(/<AuthFlow\b/);
      expect(page).not.toMatch(/<AuthFlow[^>]*\brole=/);
    }
    expect(auth).toMatch(/role = "student"/);
  });
  it("every door has an h1 that follows the login/signup switch", () => {
    expect(auth).toMatch(/<h1[^>]*>\{HEADING\[role\]\[mode\]\}<\/h1>/);
    expect(auth).toContain('login: "Log in to Navo"');
    expect(auth).toContain('signup: "Create your Navo account"');
  });
  it("signup carries ONE value line; the price stays the Stripe-driven terms line", () => {
    expect(auth).toMatch(/role === "student" && mode === "signup" && <p[^>]*>\{VALUE_LINE\}<\/p>/);
    expect(auth).toMatch(/const VALUE_LINE = "[^"]*Canvas[^"]*"/);
    expect(auth).not.toMatch(/\b4[.,]99\b/);
  });
  it("/admin/login exists, passes the admin role, and stays out of search", () => {
    expect(existsSync("app/admin/login/page.tsx")).toBe(true);
    const admin = read("app/admin/login/page.tsx");
    expect(admin).toMatch(/<AuthFlow[^>]*\brole="admin"/);
    expect(admin).toMatch(/robots: \{ index: false/);
  });
  it("nothing in app/, components/ or lib/ links to /admin/login (docs may describe it)", () => {
    const files = ["app", "components", "lib"].flatMap(walk);
    expect(files.length).toBeGreaterThan(100);
    // Any quoted path, href, push or template literal naming the route counts as a link.
    const linking = files.filter((f) => /["'`]\/admin\/login/.test(read(f)));
    expect(linking).toEqual([]);
  });
});

describe("2 · Terms and Privacy are real links; the checkbox validates on submit", () => {
  it("links to the live pages in a new tab", () => {
    expect(auth).toContain('TERMS_URL = "https://navolearning.com/terms"');
    expect(auth).toContain('PRIVACY_URL = "https://navolearning.com/privacy"');
    for (const k of ["TERMS_URL", "PRIVACY_URL"]) {
      expect(auth).toMatch(new RegExp(`href=\\{${k}\\} target="_blank" rel="noopener noreferrer"`));
    }
    expect(auth).toMatch(/I agree to the <LegalLinks \/>/);
    expect(auth).toMatch(/you agree to the <LegalLinks \/>/);
  });
  it("submit is never disabled by the checkbox — an unticked box is a field error", () => {
    expect(auth).not.toMatch(/disabled=\{!tos/);
    expect(auth).toMatch(/const invalid = validateAuthForm\(\{ tos \}\);\s*if \(invalid\) \{\s*showErrors\(/);
  });
  it("the client check and the server's 400 use ONE Terms wording", () => {
    expect(auth).not.toContain("Tick the box");
    const route = read("app/api/auth/signup/route.ts");
    expect(route).toContain("errors.tos = TOS_REQUIRED");
    expect(route).not.toContain("You must accept");
  });
});

describe("behaviour: the pure auth-form rules", () => {
  it("an unticked Terms box stops signup at the tos field with the shared wording", () => {
    expect(validateAuthForm({ tos: false })).toEqual({ field: "tos", message: TOS_REQUIRED });
    expect(validateAuthForm({ tos: true })).toBeNull();
  });
  it("focus goes to the first invalid field in form order", () => {
    expect(firstInvalidField({ tos: "x", email: "y" })).toBe("email");
    expect(firstInvalidField({ password: "x", inviteCode: "y" })).toBe("inviteCode");
    expect(firstInvalidField({ tos: "x" })).toBe("tos");
    expect(firstInvalidField({})).toBeNull();
    expect(firstInvalidField({ email: undefined })).toBeNull();
  });
  it("only a 401 marks the login fields invalid (not a network failure or a rate limit)", () => {
    expect(loginFieldsInvalid(401)).toBe(true);
    for (const s of [null, 429, 500, 400, 403]) expect(loginFieldsInvalid(s)).toBe(false);
  });
});

describe("3 · a network error never leaves a button stuck busy", () => {
  it.each([
    ["AuthFlow", auth, 2],
    ["SettingsForm", settings, 1],
    ["AccountForm", account, 1],
  ] as const)("%s: every submit handler has try/catch/finally around the busy state", (_name, src, n) => {
    const bodies = submitBodies(src);
    expect(bodies.length).toBe(n);
    for (const b of bodies) {
      expect(b).toMatch(/setBusy\(true\);[\s\S]*try \{[\s\S]*\} catch \{[\s\S]*\} finally \{\s*setBusy\(false\);\s*\}/);
    }
  });
});

describe("4 · errors are announced and tied to their fields", () => {
  it("AuthFlow: form-level errors are live regions; field errors are descriptions, not alerts", () => {
    expect(auth).toMatch(/id="login-error" role="alert"/);
    expect(auth).toMatch(/\{formError && \(\s*<p role="alert"/);
    expect(auth).toContain("aria-invalid");
    expect(auth).toContain("aria-describedby");
    const fieldError = auth.slice(auth.indexOf("function FieldError("), auth.indexOf("function LoginForm("));
    expect(fieldError).toMatch(/<p id=\{id\}/);
    expect(fieldError).not.toContain('role="alert"');
  });
  it("AuthFlow focuses the first bad field in an effect, after the error has rendered", () => {
    expect(auth).toMatch(/useEffect\(\(\) => \{\s*if \(invalid\) emailRef\.current\?\.focus\(\);\s*\}, \[invalid, error\]\)/);
    expect(auth).toMatch(/const first = firstInvalidField\(errors\);\s*if \(first\) refs\.current\[first\]\?\.focus\(\);\s*\}, \[errors\]\)/);
    // never focused synchronously inside the submit handler
    for (const b of submitBodies(auth)) expect(b).not.toContain(".focus()");
    expect(auth).toContain("setInvalid(loginFieldsInvalid(res.status))");
  });
  it("email/password carry name + spellCheck={false}; name, phone are typed for autofill", () => {
    expect(auth).toMatch(/name="email" type="email"/);
    expect(auth).toMatch(/name="password" type="password"/);
    expect((auth.match(/spellCheck=\{false\}/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(auth).toContain('autoComplete="name"');
    expect(auth).toMatch(/id="phone"[^>]*type="tel"/);
  });
  it("every svg left in AuthFlow is aria-hidden", () => {
    for (const m of auth.matchAll(/<svg\b[^>]*>/g)) expect(m[0]).toContain('aria-hidden="true"');
  });
  it("ConnectionsForm's result line is an alert that takes focus", () => {
    expect(conn).toMatch(/ref=\{messageRef\}\s*role="alert"\s*tabIndex=\{-1\}/);
    expect(conn).toMatch(/if \(message\) messageRef\.current\?\.focus\(\)/);
  });
});

describe("single source: the network-error line", () => {
  it.each([
    "components/AuthFlow.tsx",
    "components/SettingsForm.tsx",
    "components/AccountForm.tsx",
    "components/ConnectionsForm.tsx",
    "components/StudyTools.tsx",
    "components/NotesSection.tsx",
  ])("%s imports NETWORK_ERROR from lib/messages instead of typing it", (f) => {
    const src = read(f);
    expect(src).toMatch(/import \{[^}]*\bNETWORK_ERROR\b[^}]*\} from "@\/lib\/messages"/);
    expect(src).not.toContain(NETWORK_ERROR);
  });
});

describe("5 · Settings and Account labels, status lines, autofill", () => {
  it("Settings labels are wired to their inputs through useId", () => {
    expect(settings).toMatch(/const id = useId\(\)/);
    expect(settings).toMatch(/<label className="label" htmlFor=\{id\}>/);
    expect(settings).toMatch(/<input\s+id=\{id\}/);
    expect(settings).not.toMatch(/<label className="label">/);
  });
  it("the saved lines are live status regions", () => {
    expect(settings).toMatch(/role="status"[^>]*>\{saved \?/);
    expect(account).toMatch(/role="status"[^>]*>\{saved \?/);
  });
  it("Account autofills name and email", () => {
    expect(account).toMatch(/id="fullName"[^\n]*autoComplete="name"/);
    expect(account).toMatch(/id="email"[^\n]*autoComplete="email"/);
  });
});

describe("6 · the Canvas token step reassures, with one primary action", () => {
  it("shows what Navo can and can't do above the token field", () => {
    const panel = conn.indexOf("What Navo can and can’t do");
    expect(panel).toBeGreaterThan(-1);
    expect(panel).toBeLessThan(conn.indexOf('htmlFor="token"'));
    for (const line of [
      "Reads your courses, assignments, grades, syllabi, announcements and course materials.",
      "Never posts, submits or changes anything in Canvas.",
      "Stores your token encrypted.",
      "Account → Settings → Approved Integrations",
    ]) expect(conn).toContain(line);
  });
  it("the token field is described by the two short lines about the token, not the whole panel", () => {
    expect(conn).toContain('aria-describedby="token-never token-encrypted"');
    expect(conn).toMatch(/<li id="token-never">Never posts/);
    expect(conn).toMatch(/<li id="token-encrypted">Stores your token encrypted/);
  });
  it("gives the reason to leave the expiry blank", () => {
    expect(conn).toContain("so Navo doesn’t lose access mid-semester");
  });
  it("the token form has exactly one btn-primary (Open Canvas is secondary)", () => {
    const form = conn.slice(conn.indexOf("<form onSubmit={onSubmit}"), conn.indexOf("</form>"));
    expect((form.match(/btn-primary/g) ?? []).length).toBe(1);
    expect(form).toMatch(/className="btn-ghost[^"]*"\s*>\s*Open Canvas/);
  });
});

describe("7 · student copy, not developer copy", () => {
  const FILES = [
    "components/AuthFlow.tsx",
    "components/SettingsForm.tsx",
    "components/AccountForm.tsx",
    "components/ConnectionsForm.tsx",
    "components/SyncReportPanel.tsx",
    "components/GoogleCalendarCard.tsx",
    "lib/syncReport.ts",
    "lib/messages.ts",
  ];
  it.each(FILES)("%s has none of the retired strings", (f) => {
    const src = read(f);
    for (const s of ["credentials configured", "Your local profile.", "estimated automatically by AI", "Ran out of time this run", "Validation failed"]) {
      expect(src).not.toContain(s);
    }
  });
  it("no component spells out the non-student wording (it lives once, in lib/syncReport)", () => {
    for (const f of FILES.filter((x) => x.startsWith("components/"))) expect(read(f)).not.toContain("non-student course(s)");
  });
  it("the sync card shows readable class names through the ONE shortCourse helper", () => {
    const panel = read("components/SyncReportPanel.tsx");
    expect(panel).toContain('import { shortCourse } from "@/lib/courseName"');
    expect(panel).toContain("title={c.name}>{shortCourse(c.name)}");
  });
  it("Google Calendar's unavailable state has one wording", () => {
    const g = read("components/GoogleCalendarCard.tsx");
    expect(g).toContain(`const UNAVAILABLE = "Google Calendar isn’t available in Navo yet."`);
    expect((g.match(/\bUNAVAILABLE\b/g) ?? []).length).toBe(3);
  });
});
