"use client";

import { useEffect } from "react";
import { syncAccount } from "./trade-actions";

/** Re-renders the page every `everyMs` while the tab is visible, settling the visitor's trades on the way. */
export function AutoRefresh({ everyMs }: { everyMs: number }) {
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void syncAccount();
    }, everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return null;
}
