"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useTransition } from "react";

/** Re-renders the page every `everyMs` while the tab is visible, which also settles the visitor's trades. */
export function AutoRefresh({ everyMs }: { everyMs: number }) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  // Skip a tick while the last refresh is still loading. Next runs refreshes and server
  // actions one at a time, so a backlog of slow refreshes would hold up the visitor's orders.
  const tick = useEffectEvent(() => {
    if (document.visibilityState === "visible" && !refreshing) startTransition(() => router.refresh());
  });
  useEffect(() => {
    const timer = setInterval(tick, everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return null;
}
