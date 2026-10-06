"use client";

import { useState, type FormEvent } from "react";
import type { Signal, SignalType, SignalVisibility } from "../lib/signals";
import type { InterfaceTextValues } from "../lib/interface-texts";
import { groupSignalTypes, signalTypePresentation, signalVisibilityOptions } from "../lib/signal-presentation";

export function SignalForm({ types, initialType, signal, texts }: {
  types: SignalType[]; initialType: string; signal?: Signal; texts: InterfaceTextValues;
}) {
  const [typeKey, setTypeKey] = useState(initialType);
  const [visibility, setVisibility] = useState<SignalVisibility>(
    signal && signalVisibilityOptions(initialType).includes(signal.visibility) ? signal.visibility
      : initialType === "dating" ? "private" : "members");
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  const type = types.find((entry) => entry.key === typeKey)!;
  const presentation = signalTypePresentation(type, texts);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true); setError(false);
    try {
      const response = await fetch("/api/signals", { method: "POST", body: data, headers: { Accept: "application/json" } });
      if (!response.ok) { setError(true); return; }
      const result = await response.json() as { location: string };
      window.location.assign(result.location);
    } catch { setError(true); } finally { setPending(false); }
  }
  return <form className="aboutForm signalForm" action="/api/signals" method="post" onSubmit={submit}>
    {signal ? <><input type="hidden" name="signal_id" value={signal.id} />
      <input type="hidden" name="type_key" value={typeKey} /><strong>{presentation.name}</strong></>
      : <><label htmlFor="signal-type">{texts["signal.type"]}</label>
        <select id="signal-type" name="type_key" value={typeKey} onChange={(event) => {
          const key = event.target.value; setTypeKey(key);
          if (!signalVisibilityOptions(key).includes(visibility) || key === "dating") setVisibility(key === "dating" ? "private" : "members");
        }}>
          {groupSignalTypes(types.filter((entry) => entry.enabled), texts).map((group) => <optgroup key={group.key} label={group.name}>
            {group.types.map((entry) => <option key={entry.key} value={entry.key}>{signalTypePresentation(entry, texts).name}</option>)}
          </optgroup>)}
        </select></>}
    <p className="muted">{presentation.description}</p>
    {signal?.legacyBody ? <><p className="muted">{texts["signal.legacy_hint"]}</p>
      <details><summary>{texts["signal.original"]}</summary><p className="profileBio">{signal.label}</p></details></> : null}
    <label htmlFor="signal-label">{texts["signal.label"]}</label>
    <p id="signal-label-hint" className="muted">{texts["signal.label_hint"]}</p>
    <input id="signal-label" name="label" required maxLength={120} aria-describedby="signal-label-hint"
      placeholder={presentation.placeholder} defaultValue={signal?.legacyBody ? "" : signal?.label ?? ""} />
    <label htmlFor="signal-description">{texts["signal.description"]}</label>
    <p id="signal-description-hint" className="muted">{texts["signal.description_hint"]}</p>
    <textarea id="signal-description" name="description" maxLength={10000} aria-describedby="signal-description-hint"
      placeholder={texts["signal.description_placeholder"]}
      defaultValue={signal?.legacyBody ? signal.label : signal?.description ?? ""} />
    <label htmlFor="signal-visibility">{texts["signal.visibility"]}</label>
    <select id="signal-visibility" name="visibility" value={visibility} onChange={(event) => setVisibility(event.target.value as SignalVisibility)}>
      {signalVisibilityOptions(typeKey).map((value) => <option key={value} value={value}>{texts[`signal.visibility_${value}`]}</option>)}
    </select>
    {typeKey === "dating" ? <p className="muted privacyHint">{texts["signal.dating_hint"]}</p> : null}
    {typeKey === "need" || typeKey === "have" ? <p className="muted privacyHint">{texts["exchange.privacy_hint"]}</p> : null}
    {error ? <p className="formError" role="alert">{texts["signal.invalid"]}</p> : null}
    <button className="button primary" type="submit" disabled={pending}>{texts["signal.save"]}</button>
  </form>;
}
