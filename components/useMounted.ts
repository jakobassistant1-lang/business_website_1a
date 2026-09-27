"use client";

import { useEffect, useState } from "react";

/** False during SSR and hydration, true after mount. Use it to render anything
 *  that depends on the VIEWER's clock or zone in a hydration-safe way: render the
 *  deterministic (UTC / server) value first, the local value once mounted. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
