import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GuardianCampaignForm, GuardianCampaignPreview, type GuardianCampaignFormScenario } from "./guardian-campaign-form";
import { parseGuardianCampaignDraft } from "../lib/guardian-campaign-input";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

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

  it("shows system reward note separately from the editable message", () => {
    const html = renderToStaticMarkup(<GuardianCampaignPreview text="Свой текст" audience="Без города"
      actionLabel="Указать город" recipientCount={2} rewardNote="Награда: +1,25 DARUS за первое заполнение" />);
    expect(html).toContain("Награда: +1,25 DARUS за первое заполнение");
    expect(html).not.toContain('name="reward');
  });

  it("resets text, residence, preview and validation error when switching scenarios", async () => {
    const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    let renderer!: ReactTestRenderer;
    const town = { ...base, type: "town_meeting", defaultText: "Текст встречи", actionLabel: null,
      recipientCount: null, residenceOptions: [{ key: "city", label: "Город", count: 2 }] };
    try {
      await act(async () => { renderer = create(<GuardianCampaignForm scenario={town} />); });
      await act(async () => {
        renderer.root.findByType("select").props.onChange({ target: { value: "city" } });
        renderer.root.findByType("textarea").props.onChange({ target: { value: "Мой текст" } });
      });
      await act(async () => { renderer.root.findAllByType("button")[0].props.onClick(); });
      expect(renderer.root.findAllByProps({ "aria-label": "Предпросмотр кампании" })).toHaveLength(1);
      await act(async () => { renderer.update(<GuardianCampaignForm scenario={base} />); });
      expect(renderer.root.findByType("textarea").props.value).toBe(base.defaultText);
      expect(renderer.root.findAllByProps({ "aria-label": "Предпросмотр кампании" })).toHaveLength(0);
      await act(async () => { renderer.root.findByType("textarea").props.onChange({ target: { value: " " } }); });
      await act(async () => { renderer.root.findAllByType("button")[0].props.onClick(); });
      expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(1);
      await act(async () => { renderer.update(<GuardianCampaignForm scenario={town} />); });
      expect(renderer.root.findByType("textarea").props.value).toBe(town.defaultText);
      expect(renderer.root.findByType("select").props.value).toBe("");
      expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
      expect(renderer.root.findAllByProps({ "aria-label": "Предпросмотр кампании" })).toHaveLength(0);
    } finally {
      if (renderer) await act(async () => { renderer.unmount(); });
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  });
});
