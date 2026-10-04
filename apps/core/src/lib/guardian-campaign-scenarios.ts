import { cityKey, type GuardianParticipant, getGuardianAudienceWithDatabase } from "./guardian-audience";
import { residenceLabel } from "./profile-about";
import { GuardianCampaignValidationError } from "./guardian-campaign-input";

export type GuardianScenarioType = "profile_residence_prompt" | "profile_interests_prompt" | "town_meeting" | "online_meeting";
type Overview = Awaited<ReturnType<typeof getGuardianAudienceWithDatabase>>;
export type GuardianScenarioParameters = { residenceKey?: string };

function unique(people: GuardianParticipant[]): GuardianParticipant[] {
  return [...new Map(people.map((person) => [person.id, person])).values()];
}

export function guardianResidenceOptions(overview: Overview) {
  return overview.cities.map(({ key, residence }) => ({
    key,
    label: `${residenceLabel(residence)} (${residence.type})`,
    count: unique(overview.audience.filter((person) => person.residence && cityKey(person.residence) === key)).length,
  }));
}

export const guardianScenarios = {
  profile_residence_prompt: {
    type: "profile_residence_prompt",
    title: "Заполнить город",
    defaultText: "Укажите город в профиле. Так участникам ДАО будет проще находить друг друга рядом.",
    notificationType: "guardian.profile_residence_prompt",
    actionLabel: "Указать город",
    actionUrl: "/profile#residence-name",
    repeatPolicy: "once_per_version",
    campaignKey: "profile_residence_prompt:v1",
    audienceRule: "current_without_residence",
    audienceDescription: "Актуальные участники без указанного города",
    resolveAudience: (overview: Overview) => unique(overview.missingCity),
  },
  profile_interests_prompt: {
    type: "profile_interests_prompt",
    title: "Заполнить интересы",
    defaultText: "Добавьте несколько интересов в профиль. Так ДАО сможет находить для вас людей, сообщества и возможности, которые могут быть вам полезны.",
    notificationType: "guardian.profile_interests_prompt",
    actionLabel: "Добавить интересы",
    actionUrl: "/profile#profile-interests",
    repeatPolicy: "once_per_version",
    campaignKey: "profile_interests_prompt:v1",
    audienceRule: "current_without_any_interests",
    audienceDescription: "Актуальные участники без интересов",
    resolveAudience: (overview: Overview) => unique(overview.missingInterests),
  },
  town_meeting: {
    type: "town_meeting",
    title: "Встреча в городе",
    defaultText: "Приглашаем на встречу участников ДАО в вашем городе.",
    notificationType: "guardian.town_meeting",
    actionLabel: null,
    actionUrl: null,
    repeatPolicy: "repeatable",
    campaignKey: null,
    audienceRule: "current_exact_residence",
    audienceDescription: "Актуальные участники выбранного города",
    resolveAudience: (overview: Overview, parameters: GuardianScenarioParameters) => {
      const option = guardianResidenceOptions(overview).find(({ key }) => key === parameters.residenceKey);
      if (!option) throw new GuardianCampaignValidationError("Выберите город из списка Core.");
      return unique(overview.audience.filter((person) => person.residence && cityKey(person.residence) === option.key));
    },
  },
  online_meeting: {
    type: "online_meeting",
    title: "Онлайн-встреча",
    defaultText: "Приглашаем участников ДАО на онлайн-встречу.",
    notificationType: "guardian.online_meeting",
    actionLabel: null,
    actionUrl: null,
    repeatPolicy: "repeatable",
    campaignKey: null,
    audienceRule: "all_current",
    audienceDescription: "Все актуальные участники ДАО",
    resolveAudience: (overview: Overview) => unique(overview.audience),
  },
} as const;

export const guardianScenarioTypes = Object.keys(guardianScenarios) as GuardianScenarioType[];

export function guardianScenario(type: unknown) {
  if (typeof type !== "string" || !Object.hasOwn(guardianScenarios, type)) {
    throw new GuardianCampaignValidationError("Выберите сценарий Хранителя.");
  }
  return guardianScenarios[type as GuardianScenarioType];
}

export function resolveGuardianScenarioAudience(type: GuardianScenarioType, overview: Overview, parameters: GuardianScenarioParameters = {}) {
  return guardianScenarios[type].resolveAudience(overview, parameters);
}
