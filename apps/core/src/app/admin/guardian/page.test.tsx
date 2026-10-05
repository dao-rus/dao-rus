import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentParticipant: vi.fn(),
  hasPrototypeAdminAccess: vi.fn(),
  getGuardianAudience: vi.fn(),
  getGuardianOneShotCampaigns: vi.fn(),
  getGuardianCampaignById: vi.fn(),
  redirect: vi.fn(),
  getGuardianCampaignReward: vi.fn(),
  getGuardianDepartureSummary: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("../../../lib/guardian-campaign-reward", () => ({ getGuardianCampaignReward: mocks.getGuardianCampaignReward }));
vi.mock("../../../lib/guardian-departures", () => ({ getGuardianDepartureSummary: mocks.getGuardianDepartureSummary }));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.getCurrentParticipant }));
vi.mock("@/lib/config", () => ({ hasPrototypeAdminAccess: mocks.hasPrototypeAdminAccess }));
vi.mock("@/lib/guardian-audience", () => ({ getGuardianAudience: mocks.getGuardianAudience }));
vi.mock("@/lib/guardian-campaign", async () => ({
  ...(await import("../../../lib/guardian-campaign")),
  getGuardianOneShotCampaigns: mocks.getGuardianOneShotCampaigns,
  getGuardianCampaignById: mocks.getGuardianCampaignById,
}));
vi.mock("@/lib/profile-about", () => ({
  residenceLabel: (residence: { name: string; country: string }) => `${residence.name}, ${residence.country}`,
}));

vi.mock("../../../lib/interface-texts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/interface-texts")>();
  return { ...actual, readInterfaceTexts: async () => ({ values: Object.fromEntries(actual.interfaceTextFields.map(f => [f.key, f.defaultValue])), overrides: {} }) };
});
import GuardianPage from "./page";

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join(" ");
  if (!isValidElement(node)) return "";
  return textContent((node.props as { children?: ReactNode }).children);
}

function elementProps(node: ReactNode): Array<{ type: unknown; props: Record<string, unknown> }> {
  if (Array.isArray(node)) return node.flatMap(elementProps);
  if (!isValidElement(node)) return [];
  const props = node.props as Record<string, unknown>;
  return [{ type: node.type, props }, ...elementProps(props.children as ReactNode)];
}

describe("/admin/guardian", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getGuardianOneShotCampaigns.mockResolvedValue([]);
    mocks.getGuardianCampaignById.mockResolvedValue(null);
    mocks.getGuardianCampaignReward.mockResolvedValue({ note: "Награда: +3 DARUS за первое добавление интереса" });
    mocks.getGuardianDepartureSummary.mockResolvedValue({ last30Days: 1, total: 2, events: [
      { id: "2", participantId: "two", displayName: "Второй", type: "forum.removed", observedAt: new Date("2026-10-05T10:00:00Z") },
      { id: "1", participantId: "one", displayName: "Первый", type: "forum.left", observedAt: new Date("2026-08-01T10:00:00Z") },
    ] });
    mocks.redirect.mockImplementation((destination: string) => { throw new Error(`redirect:${destination}`); });
  });

  it("renders Telegram-only success counts from the immutable snapshot with zero Core inbox messages", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "admin" });
    mocks.hasPrototypeAdminAccess.mockReturnValue(true);
    mocks.getGuardianAudience.mockResolvedValue({ missingCity: [], missingInterests: [], audience: [], cities: [], interests: [] });
    mocks.getGuardianCampaignById.mockResolvedValue({ campaignType: "technical_broadcast", recipientCount: 3,
      telegramDeliveryCount: 2, audienceRule: { channels: { core: false, telegram: true } } });
    const content = textContent(await GuardianPage({ searchParams: Promise.resolve({ broadcast: "id" }) })).replace(/\s+/gu, " ");
    expect(content).toContain("Получателей: 3");
    expect(content).toContain("В Личку Ядра: 0");
    expect(content).toContain("Telegram поставлено в очередь: 2");
    expect(content).toContain("Без доступной Telegram-доставки: 1");
  });

  it("rejects non-admin before querying audience", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "ordinary" });
    mocks.hasPrototypeAdminAccess.mockReturnValue(false);
    await expect(GuardianPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/profile");
    expect(mocks.getGuardianAudience).not.toHaveBeenCalled();
  });

  it("renders a broadcast audience and current missing-data summaries", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "admin" });
    mocks.hasPrototypeAdminAccess.mockReturnValue(true);
    const person = { id: "one", displayName: "Участник", telegramUsername: "user", hasTelegramUserId: true,
      residence: null, interests: [] };
    mocks.getGuardianAudience.mockResolvedValue({
      missingCity: [person], missingInterests: [], audience: [person],
      cities: [], interests: [{ key: "art", label: "Искусство" }],
    });
    const page = await GuardianPage({ searchParams: Promise.resolve({ interest: ["art"], scenario: "profile_interests_prompt" }) });
    expect(mocks.getGuardianAudience).toHaveBeenCalledWith({ city: "", interests: ["art"] });
    const text = textContent(page).replace(/\s+/gu, " ");
    expect(text).toContain("Не указан город: 1");
    expect(text).toContain("За последние 30 дней: 1");
    expect(text).toContain("Всего зарегистрировано убытий: 2");
    expect(text).not.toContain("Удалён из форума");
    expect(text).not.toContain("Вышел из форума");
    expect(elementProps(page).some(({ props }) => props.href === "/admin/guardian/departures")).toBe(true);
    expect(elementProps(page).some(({ type }) => typeof type === "function" && type.name === "GuardianBroadcastForm")).toBe(true);
    expect(text).toContain("Не указаны интересы: 0");
    expect(text).toContain("Найдено участников: 1");
    for (const title of ["Заполнить город", "Заполнить интересы", "Встреча в городе", "Онлайн-встреча"]) {
      expect(text).toContain(title);
    }
    expect(elementProps(page).some(({ type }) => typeof type === "function" && type.name === "GuardianCampaignForm")).toBe(true);
    expect(elementProps(page).find(({ type }) => typeof type === "function" && type.name === "GuardianCampaignForm")?.props.scenario)
      .toMatchObject({ rewardNote: "Награда: +3 DARUS за первое добавление интереса" });
    expect(text).toContain("@user");
    expect(text).toContain("Получатели будут проверены заново перед отправкой.");
    const audienceDetails = elementProps(page).find(({ type, props }) => type === "details"
      && textContent(props.children as ReactNode).includes("Найдено участников"));
    expect(audienceDetails).toBeDefined();
    expect(audienceDetails?.props.open).toBeUndefined();
  });
});
