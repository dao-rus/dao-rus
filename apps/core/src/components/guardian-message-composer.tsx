"use client";

import { useRef, useState, type FormEvent } from "react";
import type { InterfaceTextValues } from "../lib/interface-texts";

export type GuardianComposerTemplate = {
  key: string; title: string; defaultText: string; condition: string | null;
  system: boolean; core: boolean; telegram: boolean;
  previous: { text: string; recipients: number; coreInbox: number; telegramQueued: number } | null;
};
type Preview = { recipientCount: number; text: string; actionLabel: string | null; rewardNote: string | null; core: boolean; telegram: boolean };
export type GuardianComposerProps = {
  templates: GuardianComposerTemplate[]; selectedTemplate: string; initialConditions: string[];
  cities: Array<{ key: string; label: string }>; interests: Array<{ key: string; label: string }>;
  initialCity: string; initialInterests: string[]; submissionId: string;
  audiences: Array<{ key: string; label: string }>; texts: Partial<InterfaceTextValues>;
};
export function GuardianMessageComposer(props: GuardianComposerProps) {
  const initial = props.templates.find(t => t.key === props.selectedTemplate);
  const [selection, setSelection] = useState(initial?.key ?? "");
  const [conditions, setConditions] = useState([...new Set([...props.initialConditions, ...(initial?.condition ? [initial.condition] : [])])].length
    ? [...new Set([...props.initialConditions, ...(initial?.condition ? [initial.condition] : [])])] : ["all_current"]);
  const [city, setCity] = useState(props.initialCity);
  const [interests, setInterests] = useState(props.initialInterests);
  const [text, setText] = useState(initial?.defaultText ?? "");
  const [core, setCore] = useState(initial?.core ?? true);
  const [telegram, setTelegram] = useState(initial?.telegram ?? false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const form = useRef<HTMLFormElement>(null), version = useRef(0);
  const template = props.templates.find(t => t.key === selection);
  const t = (key: keyof InterfaceTextValues) => props.texts[key] ?? "";
  const cityRequired = selection === "town_meeting" || conditions.includes("city");
  const disabled = !text.trim() || (!core && !telegram) || (cityRequired && !city) || (conditions.includes("interests") && !interests.length) || Boolean(template?.previous);
  function invalidate() { version.current++; setPreview(null); setError(null); setLoading(false); }
  function chooseTemplate(key: string) {
    const next = props.templates.find(item => item.key === key);
    setSelection(key); setText(next?.defaultText ?? ""); setConditions(next?.condition ? [next.condition] : ["all_current"]);
    setCity(""); setInterests([]); setCore(next?.core ?? true); setTelegram(next?.telegram ?? false); invalidate();
  }
  async function showPreview() {
    if (disabled || !form.current) return;
    const current = ++version.current, body = new FormData(form.current);
    body.set("stage", "preview"); setLoading(true); setError(null); setPreview(null);
    try {
      const response = await fetch("/api/admin/guardian/message", { method: "POST", body });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json() as Preview;
      if (version.current === current) setPreview(result);
    } catch (reason) { if (version.current === current) setError(reason instanceof Error ? reason.message : t("guardian.preview_error")); }
    finally { if (version.current === current) setLoading(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    if (disabled || !preview?.recipientCount || submitting) { event.preventDefault(); return; }
    setSubmitting(true);
  }
  const audience = (conditions.length ? conditions : ["all_current"]).map(key => props.audiences.find(a => a.key === key)?.label).filter(Boolean).join(" + ");
  return <form ref={form} action="/api/admin/guardian/message" method="post" className="interfaceForm" onSubmit={submit}>
    <input type="hidden" name="submission_id" value={props.submissionId} />
    <input type="hidden" name="preset" value={template?.system ? selection : ""} />
    <input type="hidden" name="template" value={template && !template.system ? selection : ""} />
    <div className="interfaceField"><label htmlFor="guardian-audience">{t("guardian.audience")}</label>
      <select id="guardian-audience" name="condition" multiple size={6} value={conditions} onChange={event => {
        const selected = Array.from(event.target.selectedOptions, option => option.value);
        setConditions([...new Set([...selected, ...(template?.system && template.condition ? [template.condition] : [])])]); invalidate();
      }}>{props.audiences.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select>
      <p className="muted">{t("guardian.audience_help")}</p>
    </div>
    <div className="interfaceField"><label htmlFor="guardian-city">{t("guardian.city")}</label>
      <select id="guardian-city" name="city" value={city} required={cityRequired} onChange={event => { setCity(event.target.value); invalidate(); }}>
        <option value="">{t("guardian.city_any")}</option>{props.cities.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
      </select>
    </div>
    <div className="interfaceField"><label htmlFor="guardian-interests">{t("guardian.interests")}</label>
      <select id="guardian-interests" name="interest" multiple size={4} value={interests} onChange={event => {
        setInterests(Array.from(event.target.selectedOptions, option => option.value)); invalidate();
      }}>{props.interests.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select>
    </div>
    <div className="interfaceField"><label htmlFor="guardian-template">{t("guardian.template")}</label>
      <select id="guardian-template" value={selection} onChange={event => chooseTemplate(event.target.value)}>
        <option value="">{t("guardian.no_template")}</option>{props.templates.map(option => <option key={option.key} value={option.key}>{option.title}</option>)}
      </select>
      {template?.system ? <p className="muted">{t("guardian.once_note")}</p> : null}
      {template?.previous ? <div role="status"><p>{t("guardian.already_sent")}</p><p>{template.previous.text}</p>
        <p>{t("guardian.result_recipients")} {template.previous.recipients}</p><p>{t("guardian.result_core")} {template.previous.coreInbox}</p>
        <p>{t("guardian.result_telegram")} {template.previous.telegramQueued}</p></div> : null}
    </div>
    <div className="interfaceField"><label htmlFor="guardian-message">{t("guardian.message")}</label>
      <textarea id="guardian-message" name="text" value={text} rows={5} required maxLength={4096} onChange={event => { setText(event.target.value); invalidate(); }} />
    </div>
    <div className="profileActions">
      <label><input type="checkbox" name="core" checked={core} onChange={event => { setCore(event.target.checked); invalidate(); }} /> {t("guardian.channel_core")}</label>
      <label><input type="checkbox" name="telegram" checked={telegram} onChange={event => { setTelegram(event.target.checked); invalidate(); }} /> {t("guardian.channel_telegram")}</label>
    </div>
    <button className="button secondary" type="button" onClick={showPreview} disabled={disabled || loading}>{t("guardian.preview")}</button>
    {error ? <p role="alert" className="alert">{error}</p> : null}
    {preview ? <section aria-label={t("guardian.preview_title")}>
      <p>{t("guardian.audience")} {audience}{city ? ` · ${props.cities.find(c => c.key === city)?.label}` : ""}
        {interests.length ? ` · ${interests.map(key => props.interests.find(i => i.key === key)?.label).join(" / ")}` : ""}</p>
      <p>{t("guardian.preview_count")} <strong>{preview.recipientCount}</strong></p>
      <p style={{ whiteSpace: "pre-wrap" }}>{preview.text}</p>
      {preview.actionLabel ? <p>{t("guardian.preview_cta")} {preview.actionLabel}</p> : null}
      {preview.rewardNote ? <p>{preview.rewardNote}</p> : null}
      <p>{t("guardian.preview_channels")} {[preview.core ? t("guardian.channel_core") : "", preview.telegram ? t("guardian.channel_telegram") : ""].filter(Boolean).join(" / ")}</p>
      <p className="muted">{t("guardian.broadcast_lead")}</p>
      <button className="button primary" type="submit" name="confirm" value="send" disabled={submitting || disabled || preview.recipientCount === 0}>
        {t("guardian.send").replace("{count}", String(preview.recipientCount))}</button>
    </section> : <p className="muted">{t("guardian.unknown_count")}</p>}
  </form>;
}
