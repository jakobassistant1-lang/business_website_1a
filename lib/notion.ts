// Notion OAuth + a minimal API client (thin fetch, no SDK — matches the app's
// convention). Server-only. Reads NOTION_CLIENT_ID / NOTION_CLIENT_SECRET /
// NOTION_REDIRECT_URI; never exposes them to the client. Notion access tokens are
// long-lived (no refresh/expiry), so storage is simpler than Google's. The CSRF
// state signer is reused from googleCalendar/auth (it's a generic, session-bound
// HMAC helper, not Google-specific).

const AUTH_URL = "https://api.notion.com/v1/oauth/authorize";
const TOKEN_URL = "https://api.notion.com/v1/oauth/token";
const API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

const MAX_DEPTH = 3; // nested toggles / list items
const MAX_BLOCKS = 600; // hard ceiling on blocks walked per page
const TEXT_BUDGET = 20000; // mirror MAX_NOTE_CHARS — stop walking early

export function isNotionConfigured(): boolean {
  return Boolean(process.env.NOTION_CLIENT_ID && process.env.NOTION_CLIENT_SECRET && process.env.NOTION_REDIRECT_URI);
}

export function buildNotionAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.NOTION_CLIENT_ID ?? "",
    redirect_uri: process.env.NOTION_REDIRECT_URI ?? "",
    response_type: "code",
    owner: "user",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function timed(url: string, init: RequestInit, ms = 15000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export interface NotionToken {
  accessToken: string;
  workspaceName: string | null;
  workspaceId: string | null;
  botId: string | null;
}

export async function exchangeNotionCode(code: string): Promise<NotionToken> {
  const basic = Buffer.from(`${process.env.NOTION_CLIENT_ID}:${process.env.NOTION_CLIENT_SECRET}`).toString("base64");
  const res = await timed(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json", "Notion-Version": NOTION_VERSION },
    body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: process.env.NOTION_REDIRECT_URI }),
  });
  if (!res.ok) throw new Error(`notion_token_exchange_failed_${res.status}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j: any = await res.json();
  return {
    accessToken: String(j.access_token ?? ""),
    workspaceName: j.workspace_name ?? null,
    workspaceId: j.workspace_id ?? null,
    botId: j.bot_id ?? null,
  };
}

function notionHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Notion-Version": NOTION_VERSION };
}

export interface NotionPageRef {
  id: string;
  title: string;
  url: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function richText(arr: any): string {
  return Array.isArray(arr) ? arr.map((t) => (typeof t?.plain_text === "string" ? t.plain_text : "")).join("") : "";
}

/** A page's display title — find the property of type "title". */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pageTitle(page: any): string {
  const props = page?.properties;
  if (props && typeof props === "object") {
    for (const key of Object.keys(props)) {
      if (props[key]?.type === "title") {
        const t = richText(props[key].title).trim();
        if (t) return t.slice(0, 200);
      }
    }
  }
  return "Untitled";
}

/** Pages the connected integration can see (most recently edited first). */
export async function searchNotionPages(token: string, query: string): Promise<NotionPageRef[]> {
  const res = await timed(`${API}/search`, {
    method: "POST",
    headers: notionHeaders(token),
    body: JSON.stringify({
      query: query || undefined,
      filter: { property: "object", value: "page" },
      sort: { direction: "descending", timestamp: "last_edited_time" },
      page_size: 25,
    }),
  });
  if (!res.ok) throw new Error(`notion_search_failed_${res.status}`);
  const j = await res.json().catch(() => ({}));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: any[] = Array.isArray(j.results) ? j.results : [];
  return results
    .filter((r) => r?.object === "page")
    .map((r) => ({ id: String(r.id), title: pageTitle(r), url: typeof r.url === "string" ? r.url : null }));
}

/** Convert one Notion block to a markdown-ish line (null = skip). Exported for tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function blockToLine(b: any): string | null {
  const type: string = b?.type;
  if (!type) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = b[type] ?? {};
  const txt = richText(data.rich_text);
  switch (type) {
    case "heading_1":
      return `# ${txt}`;
    case "heading_2":
      return `## ${txt}`;
    case "heading_3":
      return `### ${txt}`;
    case "bulleted_list_item":
    case "toggle":
      return `- ${txt}`;
    case "numbered_list_item":
      return `1. ${txt}`;
    case "to_do":
      return `- [${data.checked ? "x" : " "}] ${txt}`;
    case "quote":
    case "callout":
      return txt ? `> ${txt}` : null;
    case "code":
      return txt ? "```\n" + txt + "\n```" : null;
    case "paragraph":
      return txt || null; // drop empty paragraphs (Notion uses them for spacing)
    case "divider":
      return "---";
    case "child_page":
      return data.title ? `## ${data.title}` : null;
    default:
      return txt || null; // unknown but text-bearing block → its text, else skip
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function listChildren(token: string, blockId: string): Promise<any[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any[] = [];
  let cursor: string | undefined;
  do {
    const url = `${API}/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`;
    const res = await timed(url, { headers: notionHeaders(token) });
    if (!res.ok) break;
    const j = await res.json().catch(() => ({}));
    if (Array.isArray(j.results)) out.push(...j.results);
    cursor = j.has_more ? j.next_cursor : undefined;
  } while (cursor && out.length < MAX_BLOCKS);
  return out;
}

/** Recursively read a page's blocks into plain text/markdown (depth/blocks/chars
 *  bounded so a huge page can't run away). */
export async function fetchNotionPageText(token: string, pageId: string): Promise<string> {
  const lines: string[] = [];
  const state = { blocks: 0, chars: 0 };

  async function walk(blockId: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || state.blocks >= MAX_BLOCKS || state.chars >= TEXT_BUDGET) return;
    const children = await listChildren(token, blockId);
    for (const b of children) {
      if (state.blocks >= MAX_BLOCKS || state.chars >= TEXT_BUDGET) break;
      state.blocks++;
      const line = blockToLine(b);
      if (line) {
        const indented = depth > 0 ? `${"  ".repeat(depth)}${line}` : line;
        lines.push(indented);
        state.chars += indented.length + 1;
      }
      if (b?.has_children && depth < MAX_DEPTH) await walk(b.id, depth + 1);
    }
  }

  await walk(pageId, 0);
  return lines.join("\n").slice(0, TEXT_BUDGET).trim();
}
