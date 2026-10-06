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
  const [label, setLabel] = useState(signal?.legacyBody ? "" : signal?.label ?? "");
  const [description, setDescription] = useState(signal?.legacyBody ? signal.label : signal?.description ?? "");
  const [angelText, setAngelText] = useState("");
  const [angelPending, setAngelPending] = useState(false);
  const [angelError, setAngelError] = useState<string>();
  const [proposal, setProposal] = useState<{ typeKey: string; label: string; description: string | null }>();
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
  async function askAngel() {
    if (!angelText.trim()) return;
    setAngelPending(true); setAngelError(undefined); setProposal(undefined);
    try {
      const response = await fetch("/api/angel/compose", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: angelText }) });
      const result = await response.json() as { proposal?: typeof proposal; error?: string };
      if (!response.ok || !result.proposal) {
        setAngelError(result.error === "out_of_scope" || result.error === "suspicious_prompt" ? texts[`angel.${result.error}`] : result.error === "rate_limit" ? texts["angel.rate_limit"] : texts["angel.unavailable"]); return;
      }
      setProposal(result.proposal);
    } catch { setAngelError(texts["angel.unavailable"]); } finally { setAngelPending(false); }
  }
  return <form className="aboutForm signalForm" action="/api/signals" method="post" onSubmit={submit}>
    {!signal ? <section className="angelPanel">
      <h2>{texts["angel.compose_title"]}</h2>
      <textarea value={angelText} onChange={(event) => setAngelText(event.target.value)} maxLength={4000} placeholder={texts["angel.compose_placeholder"]} />
      <button className="button secondary" type="button" disabled={angelPending} onClick={askAngel}>{texts["angel.compose_submit"]}</button>
      {angelError ? <p className="formError" role="alert">{angelError}</p> : null}
      {proposal ? <div><h3>{texts["angel.proposal_title"]}</h3><p><strong>{proposal.label}</strong></p>
        {proposal.description ? <p className="profileBio">{proposal.description}</p> : null}
        <button className="button secondary" type="button" onClick={() => {
          setTypeKey(proposal.typeKey); setLabel(proposal.label); setDescription(proposal.description ?? "");
          if (!signalVisibilityOptions(proposal.typeKey).includes(visibility)) setVisibility(proposal.typeKey === "dating" ? "private" : "members");
          setProposal(undefined);
        }}>{texts["angel.proposal_accept"]}</button>
        <button className="button secondary" type="button" onClick={() => setProposal(undefined)}>{texts["angel.proposal_cancel"]}</button>
      </div> : null}
    </section> : null}
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
      placeholder={presentation.placeholder} value={label} onChange={(event) => setLabel(event.target.value)} />
    <label htmlFor="signal-description">{texts["signal.description"]}</label>
    <p id="signal-description-hint" className="muted">{texts["signal.description_hint"]}</p>
    <textarea id="signal-description" name="description" maxLength={10000} aria-describedby="signal-description-hint"
      placeholder={texts["signal.description_placeholder"]}
      value={description} onChange={(event) => setDescription(event.target.value)} />
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
