"use client";

import { useEffect } from "react";

// A view is reported by the opened page itself, so link prefetching, crawlers and
// messenger link previews (which do not run scripts) never inflate the counter.
// One view per browser: the list of already counted records is kept in the viewer's own
// browser and never sent anywhere, so the server still does not know who looked at what.
const STORAGE_KEY = "dao.viewedRecords";
const REMEMBERED = 3000;

function alreadyCounted(signalId: string): boolean {
  try { return (JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as string[]).includes(signalId); }
  catch { return false; }
}
function remember(signalId: string) {
  try {
    const seen = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as string[];
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen.filter((id) => id !== signalId), signalId].slice(-REMEMBERED)));
  } catch { /* Storage is unavailable (private mode): the view is still counted, just not remembered. */ }
}

export function SignalViewBeacon({ signalId }: { signalId: string }) {
  useEffect(() => {
    if (alreadyCounted(signalId)) return;
    const body = new FormData();
    body.set("action", "view");
    body.set("signal_id", signalId);
    fetch("/api/signals/card", { method: "POST", body, keepalive: true })
      .then((response) => { if (response.ok) remember(signalId); }).catch(() => {});
  }, [signalId]);
  return null;
}
