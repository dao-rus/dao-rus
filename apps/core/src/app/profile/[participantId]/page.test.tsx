import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentParticipant: vi.fn(),
  getVerificationProfile: vi.fn(),
  hasPrototypeAdminAccess: vi.fn(),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.getCurrentParticipant }));
vi.mock("@/lib/verification", () => ({ getVerificationProfile: mocks.getVerificationProfile }));
vi.mock("@/lib/config", () => ({ hasPrototypeAdminAccess: mocks.hasPrototypeAdminAccess }));
vi.mock("@/components/telegram-avatar", () => ({ TelegramAvatar: () => null }));

import SubjectProfilePage from "./page";

const rosterProfile = {
  subjectId: "20000000-0000-4000-8000-000000000002",
  displayName: "Имя из контактов экспортёра",
  hasLoggedIn: false,
  isVerified: false,
  isRoot: false,
  verificationPoints: 0,
  viewerAttestationId: null,
  viewerIsVerified: false,
};

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join(" ");
  if (!isValidElement(node)) return "";
  return textContent((node.props as { children?: ReactNode }).children);
}

describe("public subject profile name", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentParticipant.mockResolvedValue({ id: "10000000-0000-4000-8000-000000000001" });
    mocks.hasPrototypeAdminAccess.mockReturnValue(false);
    mocks.getVerificationProfile.mockResolvedValue(rosterProfile);
  });

  it("hides a roster name before the person's own login", async () => {
    const page = await SubjectProfilePage({
      params: Promise.resolve({ participantId: "20000000-0000-4000-8000-000000000002" }),
      searchParams: Promise.resolve({}),
    });

    expect(textContent(page)).toContain("Человек ещё не вошёл в Ядро");
    expect(textContent(page)).not.toContain("Имя из контактов экспортёра");
  });

  it("shows the Core name after the person's own login", async () => {
    mocks.getVerificationProfile.mockResolvedValue({
      ...rosterProfile,
      displayName: "Имя из Telegram",
      hasLoggedIn: true,
      telegramUsername: "telegram_name",
      telegramBio: "Биография из Telegram",
      telegramPhoneNumber: "+79990000000",
    });
    const page = await SubjectProfilePage({
      params: Promise.resolve({ participantId: "20000000-0000-4000-8000-000000000002" }),
      searchParams: Promise.resolve({}),
    });

    expect(textContent(page)).toContain("Имя из Telegram");
    expect(textContent(page)).toContain("@telegram_name");
    expect(textContent(page)).toContain("Биография из Telegram");
    expect(textContent(page)).not.toContain("+79990000000");
  });
});
