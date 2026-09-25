import { NAV_ICONS, type NavIconKey } from "./navIcons";

/** One stroke glyph from NAV_ICONS (currentColor, so it inherits the text tone). */
export function NavIcon({ name, size = 18 }: { name: NavIconKey; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d={NAV_ICONS[name]} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
