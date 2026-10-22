"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function CodeDiscussionDetails({ initiallyOpen, commentIds, children }: {
  initiallyOpen: boolean; commentIds: string[]; children: ReactNode;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  function markRead() {
    if (commentIds.length) void fetch("/api/code/reads", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(commentIds),
    }).catch(() => {});
  }
  useEffect(() => { if (details.current?.open) markRead(); }, []); // Initial deep link.
  return <details ref={details} className="codeDiscussion" open={initiallyOpen}
    onToggle={event => { if (event.currentTarget.open) markRead(); }}>{children}</details>;
}
