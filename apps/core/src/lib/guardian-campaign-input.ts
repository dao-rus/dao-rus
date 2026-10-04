import { safeActionUrl } from "./notification-action-url";

export const PROFILE_INTERESTS_DEFAULTS = {
  text: "Добавьте несколько интересов в профиль. Так ДАО сможет находить для вас людей, сообщества и возможности, которые могут быть вам полезны.",
  actionLabel: "Добавить интересы",
  actionUrl: "/profile#profile-interests",
};

export type GuardianCampaignDraft = { text: string; actionLabel: string; actionUrl: string };

export class GuardianCampaignValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardianCampaignValidationError";
  }
}

export function parseGuardianCampaignDraft(values: {
  text: unknown; actionLabel: unknown; actionUrl: unknown;
}): GuardianCampaignDraft {
  if (typeof values.text !== "string" || typeof values.actionLabel !== "string" || typeof values.actionUrl !== "string") {
    throw new GuardianCampaignValidationError("Заполните все поля кампании.");
  }
  const text = values.text.trim();
  const actionLabel = values.actionLabel.trim();
  const url = values.actionUrl.trim();
  if (!text || text.length > 4096) throw new GuardianCampaignValidationError("Текст сообщения должен содержать от 1 до 4096 символов.");
  if (!actionLabel || actionLabel.length > 64) throw new GuardianCampaignValidationError("Подпись кнопки должна содержать от 1 до 64 символов.");
  if (!url || url.length > 2048) throw new GuardianCampaignValidationError("Укажите допустимую ссылку действия.");
  let actionUrl: string | null;
  try { actionUrl = safeActionUrl(url); } catch { throw new GuardianCampaignValidationError("Укажите внутреннюю ссылку Core или HTTPS URL."); }
  if (!actionUrl) throw new GuardianCampaignValidationError("Укажите допустимую ссылку действия.");
  return { text, actionLabel, actionUrl };
}
