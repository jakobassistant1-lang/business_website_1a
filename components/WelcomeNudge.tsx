"use client";

// One-time "connect Canvas" nudge on the real dashboard, shown right after the
// first-run demo ends (the demo finishes by routing to /dashboard?welcome=1). It
// points a single driver.js coachmark at the "Connect Canvas" button, then strips
// the ?welcome flag so it never repeats. No-op unless ?welcome=1 AND the connect
// button is present (i.e. the student hasn't connected Canvas yet).

import { useEffect } from "react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import { CONNECT_STEP } from "@/lib/tour/demoTour";

export function WelcomeNudge() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("welcome") !== "1") return;

    const el = document.querySelector('[data-tour="connect-canvas"]');

    // Clear the flag (whether or not we show the nudge) so a refresh or Back never re-fires it.
    params.delete("welcome");
    const qs = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));

    if (!el) return; // already connected → no connect button → nothing to point at

    const d = driver({
      popoverClass: "sp-demo-tour",
      allowClose: true,
      doneBtnText: "Got it ✓",
      steps: [
        {
          element: '[data-tour="connect-canvas"]',
          popover: { title: CONNECT_STEP.title, description: CONNECT_STEP.body },
        },
      ],
    });
    d.drive();
    return () => d.destroy();
  }, []);

  return null;
}
