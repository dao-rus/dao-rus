"use client";

import { useState } from "react";
import { copySignalShareUrl, signalShareLinks, tryNativeSignalShare, type SignalSharePayload } from "../lib/signal-share";

type Labels = {
  share: string; telegram: string; vk: string; email: string; copy: string;
  copied: string; failed: string;
};

export function SignalShareAction({ payload, labels }: { payload: SignalSharePayload; labels: Labels }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const links = signalShareLinks(payload);
  async function share() {
    setNotice("");
    const result = await tryNativeSignalShare(navigator.share?.bind(navigator), payload);
    if (result === "fallback") setOpen((value) => !value);
  }
  async function copy() {
    const success = await copySignalShareUrl(navigator.clipboard?.writeText.bind(navigator.clipboard), payload.url);
    setNotice(success ? labels.copied : labels.failed);
  }
  return <div className="signalShareAction">
    <button className="button secondary" type="button" onClick={share} aria-expanded={open}>{labels.share}</button>
    {open ? <div className="signalShareMenu">
      <a href={links.telegram}>{labels.telegram}</a>
      <a href={links.vk}>{labels.vk}</a>
      <a href={links.email}>{labels.email}</a>
      <button type="button" onClick={copy}>{labels.copy}</button>
    </div> : null}
    {notice ? <span className="muted" role="status">{notice}</span> : null}
  </div>;
}
