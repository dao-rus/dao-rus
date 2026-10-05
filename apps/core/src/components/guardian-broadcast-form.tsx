"use client";

import { useState, type FormEvent } from "react";
import type { InterfaceTextValues } from "../lib/interface-texts";

type BroadcastTexts = Pick<InterfaceTextValues, "guardian.message" | "guardian.channel_core" | "guardian.channel_telegram" | "guardian.send">;
export function GuardianBroadcastForm({ city, interests, recipientCount, submissionId, texts }: {
  city: string; interests: string[]; recipientCount: number; submissionId: string; texts: BroadcastTexts;
}) {
  const [text, setText] = useState("");
  const [core, setCore] = useState(true);
  const [telegram, setTelegram] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const disabled = submitting || !text.trim() || recipientCount === 0 || (!core && !telegram);
  function submit(event: FormEvent<HTMLFormElement>) {
    if (disabled) { event.preventDefault(); return; }
    setSubmitting(true);
  }
  return <form action="/api/admin/guardian/broadcast" method="post" className="interfaceForm" onSubmit={submit}>
    <input type="hidden" name="submission_id" value={submissionId} />
    <input type="hidden" name="city" value={city} />
    {interests.map(interest => <input key={interest} type="hidden" name="interest" value={interest} />)}
    <div className="interfaceField"><label htmlFor="guardian-broadcast-message">{texts["guardian.message"]}</label>
      <textarea id="guardian-broadcast-message" name="text" rows={5} maxLength={4096} required value={text} onChange={event => setText(event.target.value)} />
    </div>
    <div className="profileActions">
      <label><input type="checkbox" name="core" checked={core} onChange={event => setCore(event.target.checked)} /> {texts["guardian.channel_core"]}</label>
      <label><input type="checkbox" name="telegram" checked={telegram} onChange={event => setTelegram(event.target.checked)} /> {texts["guardian.channel_telegram"]}</label>
    </div>
    <button className="button primary" type="submit" disabled={disabled}>{texts["guardian.send"].replace("{count}", String(recipientCount))}</button>
  </form>;
}
