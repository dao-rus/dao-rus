import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentParticipant: vi.fn(),
  readInterfaceTexts: vi.fn(),
  getOnboardingQuests: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.getCurrentParticipant }));
vi.mock("@/lib/interface-texts", () => ({ readInterfaceTexts: mocks.readInterfaceTexts }));
vi.mock("@/lib/onboarding-quests", () => ({ getOnboardingQuests: mocks.getOnboardingQuests }));
vi.mock("@/lib/config", () => ({
  isTelegramConfigured: () => true,
  devAuthEnabled: () => false,
}));

import Home from "./page";

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join(" ");
  if (!isValidElement(node)) return "";
  return textContent((node.props as { children?: ReactNode }).children);
}

describe("home interface texts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOnboardingQuests.mockResolvedValue([{ sourceType: "interest_first_added", textKey: "onboarding.interest", href: "/profile#profile-interests", amount: "0.100000" }]);
    mocks.readInterfaceTexts.mockResolvedValue({ values: {
      "home.eyebrow": "Своя надпись",
      "home.title": "Свой заголовок",
      "home.lead": "Свой основной текст",
      "home.login_button": "Свой вход",
      "home.profile_button": "Свой профиль",
      "home.code_link": "Открыть наш Кодекс",
      "home.code_title": "Кодекс руси",
      "onboarding.interest": "Добавьте интерес, чтобы найти единомышленников",
      "participants.title": "Моя сеть",
      "exchange.title": "Обмен",
      "nav.veche": "Наше вече",
    } });
  });

  it("shows overridden texts to a visitor", async () => {
    mocks.getCurrentParticipant.mockResolvedValue(null);
    const page = await Home({ searchParams: Promise.resolve({}) });
    const text = textContent(page);
    expect(text).not.toContain("Своя надпись");
    expect(text.indexOf("Кодекс руси")).toBeLessThan(text.indexOf("Свой заголовок"));
    expect(text).toContain("Свой заголовок");
    expect(text).toContain("Свой основной текст");
    expect(text).toContain("Свой вход");
    expect(text).toContain("Не нападай первым.");
    expect(text).toContain("Власть принадлежит народу.");
    expect(text).toContain("Открыть наш Кодекс");
    expect(mocks.getOnboardingQuests).not.toHaveBeenCalled();
    expect(text).not.toContain("DARUS");
  });

  it("shows the overridden profile button after login", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "participant" });
    const page = await Home({ searchParams: Promise.resolve({}) });
    expect(textContent(page)).toContain("Свой профиль");
    expect(textContent(page)).toContain("Моя сеть");
    expect(textContent(page)).toContain("Обмен");
    expect(textContent(page)).toContain("Наше вече");
    expect(textContent(page).indexOf("Наше вече")).toBeLessThan(
      textContent(page).indexOf("Добавьте интерес, чтобы найти единомышленников"),
    );
    expect(textContent(page)).toContain("0,1");
  });
});
