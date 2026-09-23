import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentParticipant: vi.fn(),
  getVerificationProfile: vi.fn(),
  getVisibleProfileAbout: vi.fn(),
  getReputationSummary: vi.fn(),
  getVerificationRewardForFeedback: vi.fn(),
  hasPrototypeAdminAccess: vi.fn(),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.getCurrentParticipant }));
vi.mock("@/lib/verification", () => ({ getVerificationProfile: mocks.getVerificationProfile }));
vi.mock("@/lib/profile-about", () => ({ getVisibleProfileAbout: mocks.getVisibleProfileAbout }));
vi.mock("@/lib/reputation", () => ({ getReputationSummary: mocks.getReputationSummary }));
vi.mock("@/lib/tokenization", () => ({
  getVerificationRewardForFeedback: mocks.getVerificationRewardForFeedback,
  formatDarusAmount: (amount: string) => amount === "0.100000" ? "0,1" : amount,
}));
vi.mock("@/components/darus-reward-celebration", () => ({
  DarusRewardCelebration: "darus-reward-celebration",
}));
vi.mock("@/components/positive-experience-feedback", () => ({
  PositiveExperienceFeedback: "positive-experience-feedback",
}));
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

function hasCelebration(node: ReactNode): boolean {
  if (Array.isArray(node)) return node.some(hasCelebration);
  if (!isValidElement(node)) return false;
  return node.type === "darus-reward-celebration"
    || hasCelebration((node.props as { children?: ReactNode }).children);
}

function hasPositiveFeedback(node: ReactNode): boolean {
  if (Array.isArray(node)) return node.some(hasPositiveFeedback);
  if (!isValidElement(node)) return false;
  return node.type === "positive-experience-feedback"
    || hasPositiveFeedback((node.props as { children?: ReactNode }).children);
}

describe("public subject profile name", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentParticipant.mockResolvedValue({ id: "10000000-0000-4000-8000-000000000001" });
    mocks.hasPrototypeAdminAccess.mockReturnValue(false);
    mocks.getVerificationProfile.mockResolvedValue(rosterProfile);
    mocks.getVisibleProfileAbout.mockResolvedValue({
      bio: "",
      bioVisibility: "members",
      interests: [],
      signals: [],
    });
    mocks.getReputationSummary.mockResolvedValue({ positiveCount: 2, viewerSignal: null });
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
    mocks.getVisibleProfileAbout.mockResolvedValue({
      bio: "Моё био в ДАО",
      bioVisibility: "members",
      interests: [{ id: "i1", label: "История", visibility: "members" }],
      signals: [{ id: "s1", kind: "can", body: "Могу редактировать тексты", visibility: "members" }],
    });

    const page = await SubjectProfilePage({
      params: Promise.resolve({ participantId: "20000000-0000-4000-8000-000000000002" }),
      searchParams: Promise.resolve({}),
    });

    const text = textContent(page);
    expect(text).toContain("Имя из Telegram");
    expect(text).toContain("@telegram_name");
    expect(text).toContain("Биография из Telegram");
    expect(text).toContain("Моё био в ДАО");
    expect(text).toContain("История");
    expect(text).toContain("Могу редактировать тексты");
    expect(text).not.toContain("+79990000000");
  });

  it("shows only positive totals and the viewer's own quality flag", async () => {
    mocks.getReputationSummary.mockResolvedValue({ positiveCount: 2, viewerSignal: "quality_flag" });
    const page = await SubjectProfilePage({
      params: Promise.resolve({ participantId: rosterProfile.subjectId }),
      searchParams: Promise.resolve({}),
    });
    const text = textContent(page);
    expect(mocks.getReputationSummary).toHaveBeenCalledWith(rosterProfile.subjectId, "10000000-0000-4000-8000-000000000001");
    expect(text).toMatch(/Хороший опыт взаимодействия:\s+2/);
    expect(text).toMatch(/Ваша текущая оценка:\s+Есть проблема/);
    expect(text).not.toContain("количество проблем");
    expect(text).not.toContain("автор");
  });

  it("does not offer self rating on one's own subject profile", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: rosterProfile.subjectId });
    const page = await SubjectProfilePage({
      params: Promise.resolve({ participantId: rosterProfile.subjectId }),
      searchParams: Promise.resolve({}),
    });
    expect(textContent(page)).not.toContain("Опыт взаимодействия");
  });

  it("shows the actual ledger reward after a new attestation", async () => {
    mocks.getVerificationRewardForFeedback.mockResolvedValue("0.100000");
    const page = await SubjectProfilePage({
      params: Promise.resolve({ participantId: rosterProfile.subjectId }),
      searchParams: Promise.resolve({
        verification_action: "created",
        verification_reward: "60000000-0000-4000-8000-000000000001",
      }),
    });
    expect(mocks.getVerificationRewardForFeedback).toHaveBeenCalledWith(
      "60000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000001",
      rosterProfile.subjectId,
    );
    expect(textContent(page)).toContain("Начислено +0,1 DARUS.");
    expect(textContent(page)).toContain("Баланс DARUS →");
    expect(hasCelebration(page)).toBe(true);
  });

  it("keeps ordinary confirmation feedback when no ledger entry belongs to this action", async () => {
    mocks.getVerificationRewardForFeedback.mockResolvedValue(null);
    const page = await SubjectProfilePage({
      params: Promise.resolve({ participantId: rosterProfile.subjectId }),
      searchParams: Promise.resolve({
        verification_action: "created",
        verification_reward: "60000000-0000-4000-8000-000000000001",
      }),
    });
    expect(textContent(page)).toContain("Ваше подтверждение сохранено.");
    expect(textContent(page)).not.toContain("Начислено");
    expect(hasCelebration(page)).toBe(false);
  });

  it("acknowledges a newly saved positive experience without DARUS feedback", async () => {
    mocks.getReputationSummary.mockResolvedValue({ positiveCount: 3, viewerSignal: "positive" });
    const page = await SubjectProfilePage({
      params: Promise.resolve({ participantId: rosterProfile.subjectId }),
      searchParams: Promise.resolve({ reputation_action: "created", reputation_signal: "positive" }),
    });
    expect(textContent(page)).toContain("Хороший опыт учтён.");
    expect(textContent(page)).not.toContain("Начислено");
    expect(hasPositiveFeedback(page)).toBe(true);
  });

  it("does not celebrate an unchanged or non-positive signal", async () => {
    mocks.getReputationSummary.mockResolvedValue({ positiveCount: 2, viewerSignal: "positive" });
    const unchanged = await SubjectProfilePage({
      params: Promise.resolve({ participantId: rosterProfile.subjectId }),
      searchParams: Promise.resolve({ reputation_action: "unchanged", reputation_signal: "positive" }),
    });
    expect(hasPositiveFeedback(unchanged)).toBe(false);

    mocks.getReputationSummary.mockResolvedValue({ positiveCount: 2, viewerSignal: "quality_flag" });
    const qualityFlag = await SubjectProfilePage({
      params: Promise.resolve({ participantId: rosterProfile.subjectId }),
      searchParams: Promise.resolve({ reputation_action: "created" }),
    });
    expect(hasPositiveFeedback(qualityFlag)).toBe(false);
  });
});
