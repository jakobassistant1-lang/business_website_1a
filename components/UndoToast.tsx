"use client";

// A small inline "…done · Undo" bar that sits directly under the row the student
// just checked off. It owns the ONLY clock in the undo window: after `durationMs`
// it calls `onExpire` (the dashboard then settles the row and, once every window has
// closed, refreshes), and Undo cancels the countdown and calls `onUndo`. Hovering or
// tabbing into the bar pauses the clock, so a student reading it — or reaching for
// the button with the keyboard — doesn't lose the window out from under them.
//
// The caller owns the aria-live region (a persistent role="status" wrapper in the
// row) so screen readers announce this bar when it appears; it deliberately doesn't
// declare a nested one of its own.
//
// `clock={false}` makes a passive mirror: it shows the same bar but never arms
// the timer. The dashboard renders a row in BOTH its phone and desktop lists (CSS
// picks which is visible, #39), so only the copy on the visible side runs the
// clock — otherwise a hidden copy would expire the window while the student
// hovers the visible one.

import { useEffect, useRef, useState } from "react";

export function UndoToast({
  message,
  onUndo,
  onExpire,
  durationMs = 6000,
  clock = true,
}: {
  message: string;
  onUndo: () => void;
  onExpire: () => void;
  durationMs?: number;
  clock?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  // Latest callback without restarting the countdown when the parent re-renders.
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;
  const remaining = useRef(durationMs);
  const startedAt = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (paused || !clock) return;
    startedAt.current = Date.now();
    const id = window.setTimeout(() => expireRef.current(), Math.max(0, remaining.current));
    timer.current = id;
    return () => {
      window.clearTimeout(id);
      timer.current = undefined;
      // Bank whatever's left so a pause resumes the window rather than restarting it.
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
    };
  }, [paused, clock]);

  const undo = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }
    onUndo();
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      // Phones (#39): the row is at least 44px and the Undo button a full 44px
      // target; at md+ both keep their original compact sizes.
      className="mx-3 mb-1 flex min-h-11 items-center justify-between gap-3 rounded-lg border border-line bg-surface-soft px-3 py-0 text-[14px] text-muted transition-colors motion-reduce:transition-none md:min-h-0 md:py-2"
    >
      <span className="min-w-0 truncate">{message}</span>
      <button
        type="button"
        onClick={undo}
        className="max-md:tap shrink-0 rounded-md px-3 py-0.5 font-medium text-accent transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring motion-reduce:transition-none md:px-1.5"
      >
        Undo
      </button>
    </div>
  );
}
