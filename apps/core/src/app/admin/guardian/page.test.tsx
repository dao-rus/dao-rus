import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentParticipant: vi.fn(),
  hasPrototypeAdminAccess: vi.fn(),
  getGuardianAudience: vi.fn(),
  getGuardianOneShotCampaigns: vi.fn(),
  getGuardianCampaignById: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.getCurrentParticipant }));
vi.mock("@/lib/config", () => ({ hasPrototypeAdminAccess: mocks.hasPrototypeAdminAccess }));
vi.mock("@/lib/guardian-audience", () => ({ getGuardianAudience: mocks.getGuardianAudience }));
vi.mock("@/lib/guardian-campaign", () => ({
  getGuardianOneShotCampaigns: mocks.getGuardianOneShotCampaigns,
  getGuardianCampaignById: mocks.getGuardianCampaignById,
}));
vi.mock("@/lib/profile-about", () => ({
  residenceLabel: (residence: { name: string; country: string }) => `${residence.name}, ${residence.country}`,
}));

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
    mocks.redirect.mockImplementation((destination: string) => { throw new Error(`redirect:${destination}`); });
  });

  it("rejects non-admin before querying audience", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "ordinary" });
    mocks.hasPrototypeAdminAccess.mockReturnValue(false);
    await expect(GuardianPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/profile");
    expect(mocks.getGuardianAudience).not.toHaveBeenCalled();
  });

  it("renders a read-only audience and current missing-data summaries", async () => {
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
    expect(text).toContain("Не указаны интересы: 0");
    expect(text).toContain("Найдено участников: 1");
    for (const title of ["Заполнить город", "Заполнить интересы", "Встреча в городе", "Онлайн-встреча"]) {
      expect(text).toContain(title);
    }
    expect(elementProps(page).some(({ type }) => typeof type === "function" && type.name === "GuardianCampaignForm")).toBe(true);
    expect(text).toContain("@user");
    expect(text).toContain("Telegram ID не подтверждает возможность отправить личное сообщение");
    const audienceDetails = elementProps(page).find(({ type, props }) => type === "details"
      && textContent(props.children as ReactNode).includes("Найдено участников"));
    expect(audienceDetails).toBeDefined();
    expect(audienceDetails?.props.open).toBeUndefined();
  });
});
