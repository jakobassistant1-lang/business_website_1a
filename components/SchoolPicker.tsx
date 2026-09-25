"use client";

import { useId, useRef, useState } from "react";
import { filterSchools, type School } from "@/lib/schools";

/** Highlight the matched span as React children — never dangerouslySetInnerHTML. */
function highlight(text: string, query: string) {
  const q = query.trim();
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <strong className="font-semibold text-ink">{text.slice(idx, idx + q.length)}</strong>
      {text.slice(idx + q.length)}
    </>
  );
}

/**
 * Accessible combobox (ARIA combobox + listbox) for picking a school. Filters the
 * verified dataset as the student types and reports the choice up via onSelect.
 * onManual switches the parent to the "enter your link manually" fallback.
 */
export function SchoolPicker({
  onSelect,
  onManual,
}: {
  onSelect: (school: School) => void;
  onManual: () => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const baseId = useId();
  // Touch start point of the current tap on an option (see onOptionTouchEnd).
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const results = filterSchools(query);
  const showList = open && query.trim().length > 0;
  // Only reference an option id that actually exists in the DOM (list open + in range).
  const activeId = showList && results[active] ? `${baseId}-opt-${active}` : undefined;

  function choose(s: School) {
    setOpen(false);
    onSelect(s);
  }

  // Touch-safe selection (#39): a finger tap selects on touchend, so the pick
  // never depends on the synthesized mouse events surviving the input's blur
  // (iOS). A touch that moved (the student scrolled the list) is not a tap.
  // preventDefault on touchend suppresses the follow-up mousedown/click, so the
  // input keeps focus and onClick doesn't fire a second time.
  function onOptionTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchStartRef.current = t ? { x: t.clientX, y: t.clientY } : null;
  }
  function onOptionTouchEnd(e: React.TouchEvent, s: School) {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    const t = e.changedTouches[0];
    if (!start || !t || Math.abs(t.clientX - start.x) > 10 || Math.abs(t.clientY - start.y) > 10) return;
    e.preventDefault();
    choose(s);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!showList) { setOpen(true); return; }
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (showList && results[active]) {
        e.preventDefault();
        choose(results[active]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false); // focus stays on the input, which already has it
      }
    }
  }

  return (
    <div>
      <label className="label" htmlFor={`${baseId}-input`}>Find your school</label>
      <div className="relative">
        <input
          id={`${baseId}-input`}
          className="field"
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={showList ? `${baseId}-listbox` : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          autoComplete="off"
          placeholder="Start typing — e.g. “UCLA” or “Miami Dade”"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => { if (query.trim()) setOpen(true); }}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        {showList && (
          <ul
            id={`${baseId}-listbox`}
            role="listbox"
            aria-label="Schools"
            className="absolute z-10 mt-1 max-h-[50dvh] w-full overflow-auto max-md:overscroll-contain rounded-lg border border-line bg-surface py-1 shadow-md md:max-h-72"
          >
            {results.length === 0 ? (
              <li className="px-3.5 py-3 text-sm text-muted md:py-2">
                No match — use “enter the link manually” below.
              </li>
            ) : (
              results.map((s, i) => (
                <li
                  key={s.host}
                  id={`${baseId}-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={`cursor-pointer px-3.5 py-2 max-md:flex max-md:min-h-12 max-md:flex-col max-md:justify-center ${i === active ? "bg-accent-soft" : "hover:bg-surface-soft"}`}
                  onMouseDown={(e) => e.preventDefault()} /* keep input focused through the click */
                  onTouchStart={onOptionTouchStart}
                  onTouchEnd={(e) => onOptionTouchEnd(e, s)}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(s)}
                >
                  <span className="block text-sm text-ink">{highlight(s.name, query)}</span>
                  <span className="block text-xs text-muted">{s.host}</span>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
      <button
        type="button"
        className="mt-2 text-sm font-medium text-accent hover:underline max-md:tap max-md:mt-1 max-md:inline-flex max-md:items-center max-md:text-left"
        onClick={onManual}
      >
        My school isn’t listed — enter the link manually
      </button>
    </div>
  );
}
