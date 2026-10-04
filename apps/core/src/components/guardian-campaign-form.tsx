"use client";

import { useState } from "react";
import {
  GuardianCampaignValidationError,
  parseGuardianCampaignDraft,
  PROFILE_INTERESTS_SCENARIO,
} from "../lib/guardian-campaign-input";

export function GuardianCampaignPreview({ text, recipientCount }: { text: string; recipientCount: number }) {
  return <section aria-label="Предпросмотр кампании">
    <p>Получатели сейчас: <strong>{recipientCount}</strong></p>
    <p>{text}</p>
    <p>Кнопка действия: {PROFILE_INTERESTS_SCENARIO.actionLabel}</p>
    <p className="muted">При подтверждении аудитория будет вычислена заново.</p>
    <button className="button primary" type="submit" name="confirm" value="launch">Подтвердить запуск кампании</button>
  </section>;
}

export function GuardianCampaignForm({ recipientCount }: { recipientCount: number }) {
  const [text, setText] = useState<string>(PROFILE_INTERESTS_SCENARIO.defaultText);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function edit(value: string) {
    setText(value);
    setPreview(null);
    setError(null);
  }

  function showPreview() {
    try {
      setPreview(parseGuardianCampaignDraft({ text }).text);
      setError(null);
    } catch (reason) {
      setPreview(null);
      setError(reason instanceof GuardianCampaignValidationError ? reason.message : "Проверьте поля кампании.");
    }
  }

  return (
    <section aria-labelledby="guardian-campaign-title">
      <h3 id="guardian-campaign-title">Предложить заполнить интересы</h3>
      <p>Получатели сейчас: <strong>{recipientCount}</strong></p>
      <form action="/api/admin/guardian/campaign" method="post" className="interfaceForm">
        <div className="interfaceField"><label htmlFor="guardian-campaign-text">Текст сообщения</label>
          <textarea id="guardian-campaign-text" name="text" value={text} onChange={(event) => edit(event.target.value)} rows={5} required maxLength={4096} />
        </div>
        <button className="button secondary" type="button" onClick={showPreview} disabled={recipientCount === 0}>Предпросмотр</button>
        {error ? <p className="alert" role="alert">{error}</p> : null}
        {preview ? <GuardianCampaignPreview text={preview} recipientCount={recipientCount} /> : null}
      </form>
    </section>
  );
}
