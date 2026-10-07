"use client";

import { useEffect } from "react";

// A view is reported by the opened page itself, so link prefetching, crawlers and
// messenger link previews (which do not run scripts) never inflate the counter.
export function SignalViewBeacon({ signalId }: { signalId: string }) {
  useEffect(() => {
    const body = new FormData();
    body.set("action", "view");
    body.set("signal_id", signalId);
    fetch("/api/signals/card", { method: "POST", body, keepalive: true }).catch(() => {});
  }, [signalId]);
  return null;
}
