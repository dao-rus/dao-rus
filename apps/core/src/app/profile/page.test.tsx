import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentParticipant: vi.fn(),
  getActivitySummary: vi.fn(),
  getMembershipHistory: vi.fn(),
  getVerificationProfile: vi.fn(),
  getProfileAbout: vi.fn(),
  readInterfaceTexts: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.getCurrentParticipant }));
vi.mock("@/lib/activity", () => ({ getActivitySummary: mocks.getActivitySummary }));
vi.mock("@/lib/membership-history", () => ({
  getMembershipHistory: mocks.getMembershipHistory,
  membershipEventLabel: vi.fn(),
}));
vi.mock("@/lib/verification", () => ({ getVerificationProfile: mocks.getVerificationProfile }));
vi.mock("@/lib/profile-about", () => ({ getProfileAbout: mocks.getProfileAbout }));
vi.mock("@/lib/interface-texts", () => ({ readInterfaceTexts: mocks.readInterfaceTexts }));
vi.mock("@/lib/config", () => ({ hasPrototypeAdminAccess: () => false }));
vi.mock("@/components/local-date-time", () => ({ LocalDateTime: () => null }));
vi.mock("@/components/telegram-avatar", () => ({ TelegramAvatar: () => null }));

import ProfilePage from "./page";

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join(" ");
  if (!isValidElement(node)) return "";
  return textContent((node.props as { children?: ReactNode }).children);
}

describe("/profile copy", () => {
  it("shows the editable eyebrow, about section and a fixed Сеть link label", async () => {
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
      interests: [],
      signals: [],
    });
    mocks.readInterfaceTexts.mockResolvedValue({ values: { "profile.eyebrow": "О себе" } });

    const page = await ProfilePage({ searchParams: Promise.resolve({}) });
    const text = textContent(page);

    expect(text).toContain("О себе");
    expect(text).toContain("Интересы");
    expect(text).toContain("Я хочу / Мне нужно / Я могу / У меня есть");
    expect(text).toContain("Сеть");
    expect(text).not.toContain("Ядро");
    expect(text).toContain("О себе в Telegram");
    expect(text).toContain("+79990000000");
  });
});
