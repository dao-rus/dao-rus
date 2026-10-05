export type GuardianCampaignDraft = { text: string };

export class GuardianCampaignValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardianCampaignValidationError";
  }
}

export function parseGuardianCampaignDraft(values: { text: unknown }): GuardianCampaignDraft {
  if (typeof values.text !== "string") throw new GuardianCampaignValidationError("Укажите текст сообщения.");
  const text = values.text.trim();
  if (!text || text.length > 4096) throw new GuardianCampaignValidationError("Текст сообщения должен содержать от 1 до 4096 символов.");
  return { text };
}

export type TechnicalBroadcastDraft = { text: string; city: string; interests: string[]; core: boolean; telegram: boolean; submissionId: string };
export function parseTechnicalBroadcastDraft(values: { text: unknown; city?: unknown; interests?: unknown; core: unknown; telegram: unknown; submissionId: unknown }): TechnicalBroadcastDraft {
  const { text } = parseGuardianCampaignDraft(values);
  if (typeof values.core !== "boolean" || typeof values.telegram !== "boolean" || (!values.core && !values.telegram)) throw new GuardianCampaignValidationError("Выберите хотя бы один канал доставки.");
  if (typeof values.submissionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(values.submissionId)) throw new GuardianCampaignValidationError("Недопустимый ключ отправки.");
  const city = values.city ?? "", interests = values.interests ?? [];
  if (typeof city !== "string" || city.length > 1024 || !Array.isArray(interests) || interests.length > 100 || interests.some(i => typeof i !== "string" || !i.trim() || i.length > 200)) throw new GuardianCampaignValidationError("Проверьте фильтры аудитории.");
  return { text, city: city.trim(), interests: [...new Set((interests as string[]).map(i => i.trim()))].sort(), core: values.core, telegram: values.telegram, submissionId: values.submissionId.toLowerCase() };
}
