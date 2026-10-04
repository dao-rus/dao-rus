import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GuardianCampaignForm, GuardianCampaignPreview } from "./guardian-campaign-form";
import { parseGuardianCampaignDraft, PROFILE_INTERESTS_SCENARIO } from "../lib/guardian-campaign-input";

describe("Guardian campaign preview", () => {
  it("starts with editable defaults and exposes no launch confirmation before preview", () => {
    const html = renderToStaticMarkup(<GuardianCampaignForm recipientCount={7} />);
    expect(html).toContain("Получатели сейчас: <strong>7</strong>");
    expect(html).toContain(PROFILE_INTERESTS_SCENARIO.defaultText);
    expect(html).toContain('name="text"');
    expect(html).not.toContain('name="action_label"');
    expect(html).not.toContain('name="action_url"');
    expect(html).not.toContain("Ссылка действия");
    expect(html).toContain('type="button"');
    expect(html).not.toContain('name="confirm"');
    expect(html).not.toContain("Подтвердить запуск кампании");
  });

  it("previews normalized editable values without writing data", () => {
    const { text } = parseGuardianCampaignDraft({ text: "  Новый текст  " });
    expect(text).toBe("Новый текст");
    const html = renderToStaticMarkup(<GuardianCampaignPreview text={text} recipientCount={7} />);
    expect(html).toContain("Новый текст");
    expect(html).toContain("Кнопка действия: Добавить интересы");
    expect(html).toContain('name="confirm"');
    expect(html).not.toContain("/profile#profile-interests");
    expect(PROFILE_INTERESTS_SCENARIO.actionLabel).toBe("Добавить интересы");
    expect(PROFILE_INTERESTS_SCENARIO.actionUrl).toBe("/profile#profile-interests");
  });
});
