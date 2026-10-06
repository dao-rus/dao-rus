"use client";

import { useEffect, useState } from "react";
import { copySignalShareUrl, signalShareLinks, tryNativeSignalShare, type SignalSharePayload } from "../lib/signal-share";

type Labels = {
  share: string; telegram: string; vk: string; ok: string; whatsapp: string; email: string; copy: string; more: string;
  copied: string; failed: string;
};

export function SignalShareAction({ payload, labels }: { payload: SignalSharePayload; labels: Labels }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const links = signalShareLinks(payload);
  const [canNativeShare, setCanNativeShare] = useState(false);
  useEffect(() => setCanNativeShare(typeof navigator.share === "function"), []);
  // Our menu always opens first; the system share sheet is reached through "More".
  async function more() {
    setNotice("");
    const result = await tryNativeSignalShare(navigator.share?.bind(navigator), payload);
    if (result !== "cancelled") setOpen(false);
  }
  async function copy() {
    const success = await copySignalShareUrl(navigator.clipboard?.writeText.bind(navigator.clipboard), payload.url);
    setNotice(success ? labels.copied : labels.failed);
  }
  return <div className="signalShareAction">
    <button className="button secondary" type="button" onClick={() => { setNotice(""); setOpen((value) => !value); }} aria-expanded={open}>{labels.share}</button>
    {open ? <div className="signalShareMenu">
      <a href={links.telegram}>{labels.telegram}</a>
      <a href={links.vk}>{labels.vk}</a>
      <a href={links.ok}>{labels.ok}</a>
      <a href={links.whatsapp}>{labels.whatsapp}</a>
      <a href={links.email}>{labels.email}</a>
      <button type="button" onClick={copy}>{labels.copy}</button>
      {canNativeShare ? <button type="button" onClick={more}>{labels.more}</button> : null}
    </div> : null}
    {notice ? <span className="muted" role="status">{notice}</span> : null}
  </div>;
}
