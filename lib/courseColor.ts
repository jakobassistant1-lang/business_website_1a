// Deterministic per-course colors for data-viz. This is the ONE sanctioned
// exception to the "no hardcoded colors" rule: categorical hues must be stable
// and distinguishable, and must NOT flip with the theme the way status tokens
// (danger/warning/success) do. Shared by Calendar + Timeline so a class is the
// same color everywhere.

const COURSE_COLORS = ["#7c5cf0", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#6366f1", "#14b8a6"];

export function courseColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return COURSE_COLORS[h % COURSE_COLORS.length];
}

/** Black or white text that stays readable on the given hex background, chosen by
 *  relative luminance (WCAG), so labels on any course hue keep enough contrast. */
export function pickTextOn(hex: string): "#000000" | "#ffffff" {
  const c = hex.replace("#", "");
  const toLin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const r = toLin(parseInt(c.slice(0, 2), 16) / 255);
  const g = toLin(parseInt(c.slice(2, 4), 16) / 255);
  const b = toLin(parseInt(c.slice(4, 6), 16) / 255);
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.45 ? "#000000" : "#ffffff";
}
