import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signals: vi.fn(),
  types: vi.fn(),
  getCurrentParticipant: vi.fn(),
  getActivitySummary: vi.fn(),
  getMembershipHistory: vi.fn(),
  getVerificationProfile: vi.fn(),
  getProfileAbout: vi.fn(),
  readInterfaceTexts: vi.fn(),
  getDarusBalance: vi.fn(),
  getReputationSummary: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.getCurrentParticipant }));
vi.mock("@/lib/award-access", () => ({ hasAwardCapability: () => false }));
vi.mock("@/lib/activity", () => ({ getActivitySummary: mocks.getActivitySummary }));
vi.mock("@/lib/membership-history", () => ({
  getMembershipHistory: mocks.getMembershipHistory,
  membershipEventLabel: vi.fn(),
}));
vi.mock("@/lib/verification", () => ({ getVerificationProfile: mocks.getVerificationProfile }));
vi.mock("@/lib/profile-about", () => ({
  getProfileAbout: mocks.getProfileAbout,
  residenceLabel: ({ name, country }: { name: string; country: string }) => `${name}, ${country}`,
  residenceDirectoryHref: () => "/participants?residence_name=Kazan",
}));
vi.mock("@/lib/interface-texts", () => ({ readInterfaceTexts: mocks.readInterfaceTexts }));
vi.mock("@/lib/tokenization", () => ({ getDarusBalance: mocks.getDarusBalance }));
vi.mock("@/lib/forum-join-history", () => ({ getForumJoinDate: async () => null }));
vi.mock("@/lib/reputation", () => ({ getReputationSummary: mocks.getReputationSummary }));
vi.mock("@/lib/config", () => ({ hasPrototypeAdminAccess: () => false, isParticipantsDirectoryEnabled: () => false, telegramReceptionConfig: () => ({
  token: "token", webhookSecret: "secret", forumChatId: "-100", forumInviteUrl: "https://t.me/c/1", botUsername: "Daorus_bot",
}) }));
vi.mock("@/components/local-date-time", () => ({ LocalDateTime: () => null }));
vi.mock("@/components/telegram-avatar", () => ({ TelegramAvatar: () => null }));

import ProfilePage from "./page";
import { ProfileSignals } from "../../components/profile-signals";
vi.mock("../../lib/signals", () => ({ listParticipantSignals: mocks.signals, listSignalTypes: mocks.types }));

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join(" ");
  if (!isValidElement(node)) return "";
  if (node.type === ProfileSignals) return textContent(ProfileSignals(node.props as Parameters<typeof ProfileSignals>[0]));
  return textContent((node.props as { children?: ReactNode }).children);
}

function findProps(node: ReactNode, matches: (props: Record<string, unknown>) => boolean): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findProps(child, matches);
      if (found) return found;
    }
  }
  if (!isValidElement(node)) return null;
  const props = node.props as Record<string, unknown>;
  return matches(props) ? props : findProps(props.children as ReactNode, matches);
}

describe("/profile copy", () => {
  it("shows the editable eyebrow, about section and navigation labels", async () => {
    mocks.signals.mockResolvedValue([]);
    mocks.types.mockResolvedValue([]);
    mocks.getCurrentParticipant.mockResolvedValue({
      id: "10000000-0000-4000-8000-000000000001",
      displayName: "Анна",
      telegramUsername: "anna",
      telegramBio: "О себе в Telegram",
      telegramPhoneNumber: "+79990000000",
      telegramPhoneVerified: true,
      membershipStatus: "none",
      createdAt: new Date("2026-09-20T00:00:00Z"),
    });
    mocks.getActivitySummary.mockResolvedValue({ events30d: 0, lastActivityAt: null });
    mocks.getMembershipHistory.mockResolvedValue([]);
    mocks.getVerificationProfile.mockResolvedValue({ isVerified: false });
    mocks.getProfileAbout.mockResolvedValue({
      bio: "",
      bioVisibility: "members",
      age: 51,
      city: "Пенза",
      occupation: "Автослесарь",
      residence: { name: "Казань", type: "город", country: "Россия" },
      interests: [],
      signals: [],
    });
    mocks.readInterfaceTexts.mockResolvedValue({ values: {
      "signal.create": "Добавить сигнал", "profile.eyebrow": "О себе", "participants.title": "Моя сеть", "exchange.title": "Обмен",
      "profile.reception_link": "Открыть Приёмную ДАО Русь",
    } });
    mocks.getDarusBalance.mockResolvedValue("0.100000");
    mocks.getReputationSummary.mockResolvedValue({ positiveCount: 2, viewerSignal: null });

    const page = await ProfilePage({ searchParams: Promise.resolve({}) });
    const text = textContent(page);

    expect(text).toContain("О себе");
    expect(text).toContain("Интересы");
    expect(text).toContain("Добавить сигнал");
    expect(text).not.toContain("Я хочу");
    expect(text).not.toContain("Мне нужно");
    expect(text).not.toContain("Я могу");
    expect(text).not.toContain("У меня есть");
    expect(text).toContain("Кому видно");
    expect(text).not.toContain("Кто видит");
    expect(findProps(page, (props) => props.current === "profile")?.texts).toMatchObject({
      "participants.title": "Моя сеть", "exchange.title": "Обмен",
    });
    expect(text).not.toContain("Ядро");
    expect(text).toContain("О себе в Telegram");
    expect(text).toContain("+79990000000");
    expect(text).toContain("0.100000");
    expect(text).toContain("История начислений");
    expect(text).toMatch(/Положительных сигналов:\s+2/);
    expect(text).toContain("Сохранить профиль");
    expect(text).not.toContain("Открыть Приёмную ДАО Русь");
    expect(findProps(page, (props) => props.href === "https://t.me/Daorus_bot?start=core")).toBeNull();
    expect(text).toContain("Казань, Россия");
    expect(text).toContain("Возраст 51");
    expect(text).toContain("Пенза");
    expect(text).toContain("Автослесарь");
    expect(findProps(page, (props) => props.name === "residence_name")?.form).toBe("profile-form");
    expect(findProps(page, (props) => props.name === "residence_type")?.form).toBe("profile-form");
    expect(findProps(page, (props) => props.name === "residence_country")?.form).toBe("profile-form");
    expect(text).toContain("п.г.т.");
    expect(text).toContain("деревня");
    expect(text).toContain("село");
    mocks.getProfileAbout.mockResolvedValue({ bio: "", bioVisibility: "members", residence: null,
      interests: [], signals: [],
    });
    const blankPage = await ProfilePage({ searchParams: Promise.resolve({}) });
    expect(findProps(blankPage, (props) => props.name === "residence_type")?.defaultValue).toBe("город");
    expect(findProps(blankPage, (props) => props.name === "residence_country")?.defaultValue).toBe("Россия");
    mocks.getProfileAbout.mockResolvedValue({ bio: "", bioVisibility: "members",
      residence: { name: "Кущёвская", type: "станица", country: "Россия" }, interests: [], signals: [],
    });
    const legacyPage = await ProfilePage({ searchParams: Promise.resolve({}) });
    expect(findProps(legacyPage, (props) => props.name === "residence_type")?.defaultValue).toBe("станица");
    expect(textContent(legacyPage)).toContain("станица");
    expect(text).not.toContain("Сохранить био");
    expect(findProps(page, (props) => props.id === "profile-form")?.action).toBe("/api/profile");
    expect(findProps(page, (props) => props.name === "bio")?.form).toBe("profile-form");
    expect(findProps(page, (props) => props.name === "visibility" && props.id === "bio-visibility")?.form).toBe("profile-form");
    expect(findProps(page, (props) => props.children === "Сохранить профиль")?.form).toBe("profile-form");
  });
});

vi.mock("@/lib/award-views", () => ({ getAwardBadges: vi.fn().mockResolvedValue({}), getOwnAwardOffers: vi.fn().mockResolvedValue([]) }));
