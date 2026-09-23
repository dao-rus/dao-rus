"use client";

import { useEffect, useState } from "react";

export function PositiveExperienceFeedback() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(true);

    const url = new URL(window.location.href);
    url.searchParams.delete("reputation_action");
    url.searchParams.delete("reputation_signal");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);

    const timeout = window.setTimeout(() => setVisible(false), 2200);
    return () => window.clearTimeout(timeout);
  }, []);

  if (!visible) return null;
  return <div className="reputationFeedbackToast" aria-hidden="true">
    <span className="reputationFeedbackIcon">✓</span>
    <strong>Хороший опыт учтён</strong>
  </div>;
}
