// The ONE roving-focus key rule for composite widgets (tablists, menus).
// Pure: given the key, the current index and the item count, return the index
// to move to, or null when the key isn't a navigation key (let it through).
// Arrows wrap; Home/End jump. `axis` picks which arrow pair moves: tabs are
// horizontal (Left/Right), menus vertical (Up/Down). An index outside the list
// (e.g. -1, nothing focused yet) steps in from the matching end.

export type NavAxis = "horizontal" | "vertical";

export function nextIndex(key: string, i: number, len: number, axis: NavAxis = "horizontal"): number | null {
  if (len <= 0) return null;
  const last = len - 1;
  const [prevKey, nextKey] = axis === "horizontal" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
  const inList = i >= 0 && i <= last;
  switch (key) {
    case nextKey:
      return !inList || i === last ? 0 : i + 1;
    case prevKey:
      return !inList || i === 0 ? last : i - 1;
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
}
