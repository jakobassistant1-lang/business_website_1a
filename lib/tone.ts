// Shared semantic-tone → Tailwind-class maps. One source of truth for the
// success/warning/danger/neutral styling that status pills, notices, and toast
// accents all use, so a palette tweak is a one-line change here (not a hunt
// across ConnectionsForm / PlanView / KanbanBoard).

export type Tone = "success" | "warning" | "danger" | "neutral";

/** Soft background + readable foreground — for status pills and notice banners. */
export const toneSoft: Record<Tone, string> = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-surface-soft text-muted",
};

/** Solid accent bar — for the toast stripe. */
export const toneBar: Record<Tone | "info", string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-faint",
  info: "bg-accent",
};
