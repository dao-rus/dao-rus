"use client";

import { copySignalShareUrl, tryNativeSignalShare } from "@/lib/signal-share";
import { useState } from "react";

function ShareIcon() {
  return <svg className="slovotvorShareIcon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <path d="m8.59 13.51 6.83 3.98" />
    <path d="m15.41 6.51-6.82 3.98" />
  </svg>;
}

export function SlovotvorShareAction({ url }: { url: string }) {
  const [notice, setNotice] = useState("");

  async function share() {
    setNotice("");
    const result = await tryNativeSignalShare(navigator.share?.bind(navigator), { label: "Словотвор", description: null, url });
    if (result === "shared" || result === "cancelled") return;
    if (await copySignalShareUrl(navigator.clipboard?.writeText.bind(navigator.clipboard), url)) {
      setNotice("Ссылка скопирована");
    }
  }

  return <div className="slovotvorShareAction">
    <button className="slovotvorShareButton" type="button" onClick={share}>
      <ShareIcon />
      <span>Поделиться</span>
    </button>
    {notice ? <span className="slovotvorShareNotice" role="status">{notice}</span> : null}
  </div>;
}
