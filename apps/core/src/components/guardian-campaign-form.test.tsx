import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GuardianCampaignForm } from "./guardian-campaign-form";
import { parseGuardianCampaignDraft, PROFILE_INTERESTS_DEFAULTS } from "../lib/guardian-campaign-input";

describe("Guardian campaign preview", () => {
  it("starts with editable defaults and exposes no launch confirmation before preview", () => {
    const html = renderToStaticMarkup(<GuardianCampaignForm recipientCount={7} />);
    expect(html).toContain("Получатели сейчас: <strong>7</strong>");
    expect(html).toContain(PROFILE_INTERESTS_DEFAULTS.text);
    expect(html).toContain(PROFILE_INTERESTS_DEFAULTS.actionLabel);
    expect(html).toContain(PROFILE_INTERESTS_DEFAULTS.actionUrl);
    expect(html).toContain('type="button"');
    expect(html).not.toContain('name="confirm"');
    expect(html).not.toContain("Подтвердить запуск кампании");
  });

  it("previews normalized editable values without writing data", () => {
    expect(parseGuardianCampaignDraft({ text: "  Новый текст  ", actionLabel: "  Перейти  ",
      actionUrl: " /profile#profile-interests " })).toEqual({
      text: "Новый текст", actionLabel: "Перейти", actionUrl: "/profile#profile-interests",
    });
  });
});
