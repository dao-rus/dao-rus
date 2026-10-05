"use client";

import { useState } from "react";
import { GuardianCampaignValidationError, parseGuardianCampaignDraft } from "../lib/guardian-campaign-input";

export type GuardianCampaignFormScenario = {
  type: string;
  title: string;
  defaultText: string;
  actionLabel: string | null;
  audienceDescription: string;
  recipientCount: number | null;
  residenceOptions: Array<{ key: string; label: string; count: number }>;
  rewardNote?: string | null;
};

export function GuardianCampaignPreview({ text, audience, actionLabel, recipientCount, rewardNote }: {
  text: string; audience: string; actionLabel: string | null; recipientCount: number;
  rewardNote?: string | null;
}) {
  return <section aria-label="Предпросмотр кампании">
    <p>Получатели сейчас: <strong>{recipientCount}</strong></p>
    <p>Аудитория: {audience}</p>
    <p>{text}</p>
    {rewardNote ? <p>{rewardNote}</p> : null}
    {actionLabel ? <p>Кнопка действия: {actionLabel}</p> : null}
    <p className="muted">При подтверждении аудитория будет вычислена заново.</p>
    <button className="button primary" type="submit" name="confirm" value="launch">
      Подтвердить запуск для {recipientCount} участников
    </button>
  </section>;
}

export function GuardianCampaignForm({ scenario }: { scenario: GuardianCampaignFormScenario }) {
  return <ScenarioForm key={scenario.type} scenario={scenario} />;
}

function ScenarioForm({ scenario }: { scenario: GuardianCampaignFormScenario }) {
  const [text, setText] = useState<string>(scenario.defaultText);
  const [residenceKey, setResidenceKey] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedResidence = scenario.residenceOptions.find((option) => option.key === residenceKey);
  const recipientCount = scenario.type === "town_meeting" ? (selectedResidence?.count ?? null) : scenario.recipientCount;
  const audience = selectedResidence ? `Участники города ${selectedResidence.label}` : scenario.audienceDescription;

  function invalidatePreview() { setPreview(null); setError(null); }

  function showPreview() {
    try {
      setPreview(parseGuardianCampaignDraft({ text }).text);
      setError(null);
    } catch (reason) {
      setPreview(null);
      setError(reason instanceof GuardianCampaignValidationError ? reason.message : "Проверьте текст сообщения.");
    }
  }

  return <section aria-labelledby="guardian-campaign-title">
    <h3 id="guardian-campaign-title">{scenario.title}</h3>
    <p>{scenario.audienceDescription}</p>
    <p>Получатели сейчас: <strong>{recipientCount ?? "выберите город"}</strong></p>
    <form action="/api/admin/guardian/campaign" method="post" className="interfaceForm">
      <input type="hidden" name="scenario" value={scenario.type} />
      {scenario.type === "town_meeting" ? <div className="interfaceField">
        <label htmlFor="guardian-campaign-residence">Город</label>
        <select id="guardian-campaign-residence" name="residence" value={residenceKey}
          onChange={(event) => { setResidenceKey(event.target.value); invalidatePreview(); }} required>
          <option value="">Выберите город</option>
          {scenario.residenceOptions.map((option) => <option key={option.key} value={option.key}>
            {option.label} — {option.count}
          </option>)}
        </select>
      </div> : null}
      <div className="interfaceField"><label htmlFor="guardian-campaign-text">Текст сообщения</label>
        <textarea id="guardian-campaign-text" name="text" value={text}
          onChange={(event) => { setText(event.target.value); invalidatePreview(); }} rows={5} required maxLength={4096} />
      </div>
      <button className="button secondary" type="button" onClick={showPreview}
        disabled={recipientCount === null || recipientCount === 0}>Предпросмотр</button>
      {error ? <p className="alert" role="alert">{error}</p> : null}
      {preview !== null && recipientCount !== null
        ? <GuardianCampaignPreview text={preview} audience={audience} actionLabel={scenario.actionLabel} recipientCount={recipientCount} rewardNote={scenario.rewardNote} />
        : null}
    </form>
  </section>;
}
