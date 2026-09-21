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

import { useEffect, useRef, useState } from "react";

export function UndoToast({
  message,
  onUndo,
  onExpire,
  durationMs = 6000,
}: {
  message: string;
  onUndo: () => void;
  onExpire: () => void;
  durationMs?: number;
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
    if (paused) return;
    startedAt.current = Date.now();
    const id = window.setTimeout(() => expireRef.current(), Math.max(0, remaining.current));
    timer.current = id;
    return () => {
      window.clearTimeout(id);
      timer.current = undefined;
      // Bank whatever's left so a pause resumes the window rather than restarting it.
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
    };
  }, [paused]);

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
      className="mx-3 mb-1 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-soft px-3 py-2 text-[14px] text-muted transition-colors motion-reduce:transition-none"
    >
      <span className="min-w-0 truncate">{message}</span>
      <button
        type="button"
        onClick={undo}
        className="shrink-0 rounded-md px-1.5 py-0.5 font-medium text-accent transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring motion-reduce:transition-none"
      >
        Undo
      </button>
    </div>
  );
}
