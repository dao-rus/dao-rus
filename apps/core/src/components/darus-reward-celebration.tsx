"use client";

import { useEffect, useRef, useState } from "react";

type DarusRewardCelebrationProps = {
  entryId: string;
  amount: string;
  caption?: string;
  // Tell the server once the animation was shown, for rewards that wait for the owner's next visit.
  announce?: boolean;
};

export function claimDarusRewardAnimation(
  entryId: string,
  storage: Pick<Storage, "getItem" | "setItem">,
): boolean {
  const key = `darus-reward-seen:${entryId}`;
  if (storage.getItem(key) === "1") return false;
  storage.setItem(key, "1");
  return true;
}

export function DarusRewardCelebration({ entryId, amount, caption = "За подтверждение личности", announce = false }: DarusRewardCelebrationProps) {
  const [visible, setVisible] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      let shouldAnimate = true;
      try {
        shouldAnimate = claimDarusRewardAnimation(entryId, sessionStorage);
      } catch {
        // The visual feedback still works when browser storage is unavailable.
      }
      if (shouldAnimate) setVisible(true);
      if (announce) {
        const body = new FormData();
        body.set("entry_id", entryId);
        fetch("/api/rewards/shown", { method: "POST", body, keepalive: true }).catch(() => {});
      }

      const url = new URL(window.location.href);
      url.searchParams.delete("verification_reward");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }

    const timeout = window.setTimeout(() => setVisible(false), 2200);
    return () => window.clearTimeout(timeout);
  }, [entryId, announce]);

  if (!visible) return null;
  return (
    <div className="darusCelebration" aria-hidden="true">
      <span className="darusRewardMarker"><span className="darusCoin">D</span> +{amount} DARUS</span>
      <div className="darusRewardToast">
        <span className="darusCoin">D</span>
        <div><strong>+{amount} DARUS</strong><small>{caption}</small></div>
      </div>
    </div>
  );
}
