import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GuardianCampaignForm, GuardianCampaignPreview, type GuardianCampaignFormScenario } from "./guardian-campaign-form";
import { parseGuardianCampaignDraft } from "../lib/guardian-campaign-input";

const base: GuardianCampaignFormScenario = {
  type: "profile_interests_prompt", title: "Заполнить интересы", defaultText: "Начальный текст",
  actionLabel: "Добавить интересы", audienceDescription: "Участники без интересов",
  recipientCount: 7, residenceOptions: [],
};

describe("Guardian campaign form and preview", () => {
  it("renders only editable message text and never exposes technical action inputs", () => {
    const html = renderToStaticMarkup(<GuardianCampaignForm scenario={base} />);
    expect(html).toContain('name="text"');
    expect(html).toContain("Начальный текст");
    expect(html).not.toContain('name="action_label"');
    expect(html).not.toContain('name="action_url"');
    expect(html).not.toContain("/profile#profile-interests");
    expect(html).not.toContain('name="confirm"');
  });

  it("shows existing city options and recipient counts for town meeting", () => {
    const html = renderToStaticMarkup(<GuardianCampaignForm scenario={{ ...base, type: "town_meeting",
      title: "Встреча в городе", actionLabel: null, recipientCount: null,
      residenceOptions: [{ key: "city-key", label: "Москва, Россия (город)", count: 2 }] }} />);
    expect(html).toContain('name="residence"');
    expect(html).toContain("Москва, Россия (город) — 2");
    expect(html).toContain("выберите город");
    expect(html).not.toContain('name="confirm"');
  });

  it("previews the edited text, audience, action and explicit recipient confirmation without a URL", () => {
    const { text } = parseGuardianCampaignDraft({ text: "  Новый текст  " });
    const html = renderToStaticMarkup(<GuardianCampaignPreview text={text} audience="Участники без интересов"
      actionLabel="Добавить интересы" recipientCount={7} />);
    expect(html).toContain("Новый текст");
    expect(html).toContain("Участники без интересов");
    expect(html).toContain("Кнопка действия: Добавить интересы");
    expect(html).toContain("Подтвердить запуск для 7 участников");
    expect(html).not.toContain("/profile#profile-interests");
  });

  it("shows no CTA for meeting previews", () => {
    const html = renderToStaticMarkup(<GuardianCampaignPreview text="Встреча" audience="Все участники"
      actionLabel={null} recipientCount={4} />);
    expect(html).not.toContain("Кнопка действия");
  });
});
