"use client";

// Phone-only (< md) Classes carousel: one course card centred per screen, the
// neighbours' edges peeking in (dimmed) so it's obvious you can swipe, and
// Instagram-style dots below. CourseGrid renders this AND the md+ grid, with CSS
// (`md:hidden` / `hidden md:grid`) choosing — so there's no first-paint swap —
// and the scroll tracking below only attaches while the phone query matches.
//
// Layout: the scroller bleeds over <main>'s 16px phone gutter (`-mx-4`, same in
// the demo frame) so peeks reach the screen edge. Widths are % of the scroller,
// not vw, so it also centres inside the demo frame. Spacer elements at both ends
// (rather than scroller padding, which some mobile engines drop at the scroll
// end) give the first/last card room to snap to the centre.

import { Children, isValidElement, useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { dotLabel, nearestIndex } from "@/lib/carousel";

const PHONE_QUERY = "(max-width: 767px)";
// Slide = 82% of the scroller (max 420px); spacer + gap-3 (12px) = the room
// needed to centre the end cards.
const SPACER = "shrink-0 w-[max(calc(9%_-_12px),calc(50%_-_222px))]";

export function CourseCarousel({ children }: { children: ReactNode }) {
  const slides = Children.toArray(children);
  const n = slides.length;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [active, setActive] = useState(0);

  const centers = useCallback(
    () => slideRefs.current.slice(0, n).map((el) => (el ? el.offsetLeft + el.offsetWidth / 2 : 0)),
    [n],
  );

  // Track the centred slide from scroll position (rAF-throttled), phones only.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(PHONE_QUERY);
    let frame = 0;
    const measure = () => {
      frame = 0;
      setActive(nearestIndex(scroller.scrollLeft, centers(), scroller.clientWidth));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    let attached = false;
    const sync = () => {
      if (mq.matches && !attached) {
        scroller.addEventListener("scroll", schedule, { passive: true });
        window.addEventListener("resize", schedule);
        attached = true;
        schedule();
      } else if (!mq.matches && attached) {
        scroller.removeEventListener("scroll", schedule);
        window.removeEventListener("resize", schedule);
        attached = false;
      }
    };
    sync();
    mq.addEventListener("change", sync);
    return () => {
      mq.removeEventListener("change", sync);
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [centers]);

  const goTo = (i: number) => {
    const scroller = scrollerRef.current;
    if (!scroller || n === 0) return;
    const idx = Math.max(0, Math.min(n - 1, i));
    const c = centers()[idx] ?? 0;
    scroller.scrollTo({ left: c - scroller.clientWidth / 2 }); // smoothness from `scroll-smooth` (off under reduced motion)
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return; // arrows inside a focused card don't move the scroller under it
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      goTo(active + (e.key === "ArrowRight" ? 1 : -1));
    }
  };

  return (
    <div className="-mx-4">
      <div
        ref={scrollerRef}
        tabIndex={0}
        role="region"
        aria-roledescription="carousel"
        aria-label="Your classes"
        onKeyDown={onKeyDown}
        className="relative flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth py-2 [scrollbar-width:none] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-ring motion-reduce:scroll-auto [&::-webkit-scrollbar]:hidden"
      >
        <div aria-hidden className={SPACER} />
        {slides.map((slide, i) => (
          <div
            key={isValidElement(slide) && slide.key != null ? slide.key : i}
            ref={(el) => {
              slideRefs.current[i] = el;
            }}
            role="group"
            aria-roledescription="slide"
            aria-label={dotLabel(i, n)}
            // A tap on a peeking neighbour centres it instead of opening it.
            onClickCapture={(e) => {
              if (i === active) return;
              e.preventDefault();
              e.stopPropagation();
              goTo(i);
            }}
            className={`grid w-[82%] max-w-[420px] shrink-0 snap-center transition-opacity duration-200 motion-reduce:transition-none ${i === active ? "opacity-100" : "opacity-60"}`}
          >
            {slide}
          </div>
        ))}
        <div aria-hidden className={SPACER} />
      </div>
      {n > 1 && (
        <div className="mt-1 flex flex-wrap justify-center px-4">
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => goTo(i)}
              aria-label={dotLabel(i, n)}
              aria-current={i === active ? "true" : undefined}
              // 44px hit areas overlap (-mx-2.5) so the dots sit 24px apart, like a photo carousel.
              className="tap -mx-2.5 flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
            >
              <span aria-hidden className={`h-2 w-2 rounded-full transition-colors duration-200 motion-reduce:transition-none ${i === active ? "bg-accent" : "bg-line"}`} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
