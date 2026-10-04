"use client";

import { useState } from "react";
import {
  GuardianCampaignValidationError,
  parseGuardianCampaignDraft,
  PROFILE_INTERESTS_DEFAULTS,
  type GuardianCampaignDraft,
} from "../lib/guardian-campaign-input";

export function GuardianCampaignForm({ recipientCount }: { recipientCount: number }) {
  const [draft, setDraft] = useState<GuardianCampaignDraft>(PROFILE_INTERESTS_DEFAULTS);
  const [preview, setPreview] = useState<GuardianCampaignDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  function edit(field: keyof GuardianCampaignDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setPreview(null);
    setError(null);
  }

  function showPreview() {
    try {
      setPreview(parseGuardianCampaignDraft(draft));
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
          <textarea id="guardian-campaign-text" name="text" value={draft.text} onChange={(event) => edit("text", event.target.value)} rows={5} required maxLength={4096} />
        </div>
        <div className="interfaceField"><label htmlFor="guardian-campaign-action-label">Кнопка действия</label>
          <input id="guardian-campaign-action-label" name="action_label" value={draft.actionLabel} onChange={(event) => edit("actionLabel", event.target.value)} required maxLength={64} />
        </div>
        <div className="interfaceField"><label htmlFor="guardian-campaign-action-url">Ссылка действия</label>
          <input id="guardian-campaign-action-url" name="action_url" value={draft.actionUrl} onChange={(event) => edit("actionUrl", event.target.value)} required maxLength={2048} />
        </div>
        <button className="button secondary" type="button" onClick={showPreview} disabled={recipientCount === 0}>Предпросмотр</button>
        {error ? <p className="alert" role="alert">{error}</p> : null}
        {preview ? <section aria-label="Предпросмотр кампании">
          <p>Получатели сейчас: <strong>{recipientCount}</strong></p>
          <p>{preview.text}</p>
          <p>Кнопка: {preview.actionLabel}</p>
          <p>Ссылка: {preview.actionUrl}</p>
          <p className="muted">При подтверждении аудитория будет вычислена заново.</p>
          <button className="button primary" type="submit" name="confirm" value="launch">Подтвердить запуск кампании</button>
        </section> : null}
      </form>
    </section>
  );
}
