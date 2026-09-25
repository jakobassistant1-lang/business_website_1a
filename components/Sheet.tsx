"use client";

// The ONE modal surface for the app shell (ticket #39, frozen interface).
// Below `md` it is a bottom sheet (full width, rounded top, drag handle, at most
// 85dvh, safe-area aware); at `md` and up the same children render as a centered
// dialog. Callers never branch on width — they just render <Sheet>.
//
// Accessibility: role="dialog" + aria-modal, labelled by the title when there is
// one; focus moves into the panel on open and back to the opener on close; Tab
// is trapped inside; Escape and a backdrop tap close it; body scroll is locked
// while open. The entrance animation is skipped under prefers-reduced-motion
// (see .sheet-panel in app/globals.css).

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const PHONE_QUERY = "(max-width: 767px)";

/** True below the `md` breakpoint. SSR-safe: false until the browser answers. */
export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const update = () => setPhone(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return phone;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Callers pass inline arrows; keep the latest in a ref so the open/close
  // effect below runs once per open, not on every parent render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Focus in on open, restore on close; lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (nodes.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const firstNode = nodes[0];
      const lastNode = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === firstNode) {
        e.preventDefault();
        lastNode.focus();
      } else if (!e.shiftKey && document.activeElement === lastNode) {
        e.preventDefault();
        firstNode.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [open]);

  if (!open || !mounted) return null;

  return createPortal(
    // Wrapper: bottom-aligned on phones (sheet), centered at md+ (dialog).
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-4">
      <div className="sheet-backdrop absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className="sheet-panel relative flex max-h-[85dvh] w-full flex-col rounded-t-2xl bg-surface pb-safe shadow-lg outline-none md:max-w-md md:rounded-2xl md:pb-0"
      >
        {/* Drag-handle bar — phones only; the dialog form has no affordance to pull. */}
        <div className="flex justify-center pt-2.5 md:hidden" aria-hidden>
          <span className="h-1 w-10 rounded-full bg-line" />
        </div>
        {title && (
          <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-3 md:pt-5">
            <h2 id={titleId} className="min-w-0 truncate text-base font-semibold text-ink">
              {title}
            </h2>
            <button type="button" onClick={onClose} aria-label="Close" className="tap -mr-2 flex items-center justify-center rounded-full text-muted hover:bg-surface-soft hover:text-ink">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-1">{children}</div>
        {footer && <div className="shrink-0 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
