"use client";

import { useEffect, useRef, useState } from "react";

type DarusRewardCelebrationProps = {
  entryId: string;
  amount: string;
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

export function DarusRewardCelebration({ entryId, amount }: DarusRewardCelebrationProps) {
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

      const url = new URL(window.location.href);
      url.searchParams.delete("verification_reward");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }

    const timeout = window.setTimeout(() => setVisible(false), 2200);
    return () => window.clearTimeout(timeout);
  }, [entryId]);

  if (!visible) return null;
  return (
    <div className="darusCelebration" aria-hidden="true">
      <span className="darusRewardMarker"><span className="darusCoin">D</span> +{amount} DARUS</span>
      <div className="darusRewardToast">
        <span className="darusCoin">D</span>
        <div><strong>+{amount} DARUS</strong><small>За подтверждение личности</small></div>
      </div>
    </div>
  );
}
