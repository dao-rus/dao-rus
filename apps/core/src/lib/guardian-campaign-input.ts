export const PROFILE_INTERESTS_SCENARIO = {
  key: "profile_interests_prompt:v1",
  type: "profile_interests_prompt",
  notificationType: "guardian.profile_interests_prompt",
  defaultText: "Добавьте несколько интересов в профиль. Так ДАО сможет находить для вас людей, сообщества и возможности, которые могут быть вам полезны.",
  actionLabel: "Добавить интересы",
  actionUrl: "/profile#profile-interests",
} as const;

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
