// The ONE copy of the shell's icon paths (24×24 stroke glyphs). The desktop
// Sidebar, the phone tab bar and the account sheet all draw from here so a
// destination's icon can't drift between the two shells. Render with NavIcon.

export const NAV_ICONS = {
  dashboard: "M4 13h7V4H4v9Zm0 7h7v-5H4v5Zm9 0h7v-9h-7v9Zm0-16v5h7V4h-7Z",
  plan: "M8 6h12M8 12h12M8 18h12M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  study: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15ZM4 19.5A2.5 2.5 0 0 0 6.5 22H20M8 7h8",
  courses: "M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v4H4zM14 15h6v4h-6z",
  connections: "M8 7a4 4 0 1 1 8 0M5 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7-3a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.4 1a7 7 0 0 0-1.7-1l-.4-2.5H9.6L9.2 5a7 7 0 0 0-1.7 1l-2.4-1-2 3.4L5 10a7 7 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 2.5h4.8l.4-2.5a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6c.06-.32.1-.65.1-1Z",
  account: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0",
  board: "M4 5h16v14H4zM9 5v14M15 5v14",
  marketing: "M4 9v6h3l5 4V5L7 9H4Z M16 9a3 3 0 0 1 0 6",
  ai: "M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4L12 3Z",
  hierarchy: "M10 3h4v4h-4zM3 17h4v4H3zM17 17h4v4h-4zM12 7v4M5 17v-2h14v2",
  burndown: "M4 4v16h16M7 8l10 9",
  replay: "M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  chevronLeft: "M15 6l-6 6 6 6",
  chevronRight: "M9 6l6 6-6 6",
  chevronDown: "M6 9l6 6 6-6",
} as const;

export type NavIconKey = keyof typeof NAV_ICONS;
