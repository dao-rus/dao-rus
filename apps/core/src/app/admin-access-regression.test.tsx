import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentParticipant: vi.fn(),
  hasPrototypeAdminAccess: vi.fn(),
  getActivitySummary: vi.fn(),
  getMembershipHistory: vi.fn(),
  getVerificationProfile: vi.fn(),
  readInterfaceTexts: vi.fn(),
  getDarusBalance: vi.fn(),
  getReputationSummary: vi.fn(),
  getCurrentRewardRule: vi.fn(),
  listParticipantRegistry: vi.fn(),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}));

vi.mock("@/lib/session", () => ({
  getCurrentParticipant: mocks.getCurrentParticipant,
}));

vi.mock("@/lib/config", () => ({
  hasPrototypeAdminAccess: mocks.hasPrototypeAdminAccess,
  telegramReceptionConfig: () => ({}),
}));

vi.mock("@/lib/activity", () => ({
  getActivitySummary: mocks.getActivitySummary,
}));

vi.mock("@/lib/membership-history", () => ({
  getMembershipHistory: mocks.getMembershipHistory,
  membershipEventLabel: vi.fn(),
}));

vi.mock("@/lib/profile-about", () => ({
  getProfileAbout: vi.fn().mockResolvedValue(null),
  getVisibleProfileAbout: vi.fn().mockResolvedValue(null),
}));
vi.mock("./../lib/signals", () => ({
  listParticipantSignals: vi.fn().mockResolvedValue([]),
  listSignalTypes: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/verification", () => ({
  getVerificationProfile: mocks.getVerificationProfile,
}));

vi.mock("@/lib/interface-texts", () => ({
  readInterfaceTexts: mocks.readInterfaceTexts,
}));
vi.mock("../lib/interface-texts", () => ({ readInterfaceTexts: mocks.readInterfaceTexts }));
vi.mock("@/lib/tokenization", () => ({
  getDarusBalance: mocks.getDarusBalance,
  getCurrentRewardRule: mocks.getCurrentRewardRule,
}));
vi.mock("@/lib/reputation", () => ({ getReputationSummary: mocks.getReputationSummary }));

vi.mock("@/lib/participant-registry", () => ({
  listParticipantRegistry: mocks.listParticipantRegistry,
  registryMembershipStatuses: ["unknown", "participant", "left", "excluded", "bot"],
  registryPresenceStatuses: ["online", "exact", "recently", "last_week", "last_month", "unknown"],
  registryVerificationStatuses: ["no_core_profile", "verified", "unverified"],
}));

vi.mock("@/components/registry-field-editor", () => ({
  RegistryFieldEditor: () => null,
}));

vi.mock("@/components/local-date-time", () => ({
  LocalDateTime: () => null,
}));
vi.mock("@/components/telegram-avatar", () => ({ TelegramAvatar: () => null }));
vi.mock("@/components/darus-reward-celebration", () => ({ DarusRewardCelebration: () => null }));
vi.mock("@/components/positive-experience-feedback", () => ({ PositiveExperienceFeedback: () => null }));

import ParticipantRegistryPage from "./admin/participants/page";
import AdminPage from "./admin/page";
import RewardsPage from "./admin/rewards/page";
import ProfilePage from "./profile/page";
import SubjectProfilePage from "./profile/[participantId]/page";

function visitTree(node: ReactNode, visit: (props: Record<string, unknown>) => void) {
  if (Array.isArray(node)) {
    node.forEach((child) => visitTree(child, visit));
    return;
  }
  if (!isValidElement(node)) return;

  const props = node.props as Record<string, unknown>;
  visit(props);
  visitTree(props.children as ReactNode, visit);
}

function treeContainsHref(node: ReactNode, href: string) {
  let found = false;
  visitTree(node, (props) => {
    if (props.href === href) found = true;
  });
  return found;
}

function treeContainsAction(node: ReactNode, action: string) {
  let found = false;
  visitTree(node, (props) => {
    if (props.action === action) found = true;
  });
  return found;
}

describe("admin access regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redirect.mockImplementation((destination: string) => {
      throw new Error(`redirect:${destination}`);
    });
    mocks.notFound.mockImplementation(() => {
      throw new Error("not-found");
    });
  });

  it("does not let a non-admin open the Participant Registry page", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "ordinary-participant" });
    mocks.hasPrototypeAdminAccess.mockReturnValue(false);

    await expect(ParticipantRegistryPage({ searchParams: Promise.resolve({}) }))
      .rejects.toThrow("redirect:/profile");
    expect(mocks.listParticipantRegistry).not.toHaveBeenCalled();
  });

  it("does not show the Participant Registry link to a non-admin", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({
      id: "ordinary-participant",
      displayName: "Обычный участник",
      telegramUsername: "ordinary",
      telegramUserId: "123",
      membershipStatus: "participant",
      createdAt: new Date("2026-09-20T12:00:00Z"),
    });
    mocks.hasPrototypeAdminAccess.mockReturnValue(false);
    mocks.getActivitySummary.mockResolvedValue({ events30d: 0, lastActivityAt: null });
    mocks.getMembershipHistory.mockResolvedValue([]);
    mocks.getVerificationProfile.mockResolvedValue({
      isVerified: false,
      isRoot: false,
      verificationPoints: 0,
    });
    mocks.readInterfaceTexts.mockResolvedValue({ values: { "profile.eyebrow": "Профиль" } });
    mocks.getDarusBalance.mockResolvedValue("0.000000");
    mocks.getReputationSummary.mockResolvedValue({ positiveCount: 0, viewerSignal: null });

    const page = await ProfilePage({ searchParams: Promise.resolve({}) });

    let hasMainNavigation = false;
    visitTree(page, (props) => { if (props.current === "profile") hasMainNavigation = true; });
    expect(hasMainNavigation).toBe(true);
    expect(treeContainsHref(page, "/admin/participants")).toBe(false);
    expect(treeContainsHref(page, "/admin")).toBe(false);
  });

  it("guards the admin dashboard and tariffs before reading rules", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "ordinary-participant" });
    mocks.hasPrototypeAdminAccess.mockReturnValue(false);
    await expect(AdminPage()).rejects.toThrow("redirect:/profile");
    await expect(RewardsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/profile");
    expect(mocks.getCurrentRewardRule).not.toHaveBeenCalled();
  });

  it("shows the protected sections in one admin dashboard", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "admin" });
    mocks.hasPrototypeAdminAccess.mockReturnValue(true);
    const page = await AdminPage();
    expect(treeContainsHref(page, "/admin/participants")).toBe(true);
    expect(treeContainsHref(page, "/admin/interface")).toBe(true);
    expect(treeContainsHref(page, "/admin/rewards")).toBe(true);
    expect(treeContainsHref(page, "/admin/reputation")).toBe(true);
    expect(treeContainsHref(page, "/admin/guardian")).toBe(true);
  });

  it("shows only one management link in the admin profile", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({
      id: "admin", displayName: "Администратор", membershipStatus: "participant",
      createdAt: new Date("2026-09-20T12:00:00Z"),
    });
    mocks.hasPrototypeAdminAccess.mockReturnValue(true);
    mocks.getActivitySummary.mockResolvedValue({ events30d: 0, lastActivityAt: null });
    mocks.getMembershipHistory.mockResolvedValue([]);
    mocks.getVerificationProfile.mockResolvedValue({ isVerified: true });
    mocks.readInterfaceTexts.mockResolvedValue({ values: { "profile.eyebrow": "Профиль" } });
    mocks.getDarusBalance.mockResolvedValue("0.000000");
    mocks.getReputationSummary.mockResolvedValue({ positiveCount: 0, viewerSignal: null });
    const page = await ProfilePage({ searchParams: Promise.resolve({}) });
    expect(treeContainsHref(page, "/admin")).toBe(true);
    expect(treeContainsHref(page, "/admin/participants")).toBe(false);
    expect(treeContainsHref(page, "/admin/interface")).toBe(false);
    expect(treeContainsHref(page, "/admin/rewards")).toBe(false);
    expect(treeContainsHref(page, "/admin/reputation")).toBe(false);
  });

  it("does not show verification root controls to a non-admin", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "ordinary-participant" });
    mocks.hasPrototypeAdminAccess.mockReturnValue(false);
    mocks.getVerificationProfile.mockResolvedValue({
      subjectId: "subject-participant",
      displayName: "Проверяемый профиль",
      isVerified: false,
      isRoot: false,
      verificationPoints: 0,
      viewerAttestationId: null,
      viewerIsVerified: false,
    });
    mocks.getReputationSummary.mockResolvedValue({ positiveCount: 0, viewerSignal: null });

    const page = await SubjectProfilePage({
      params: Promise.resolve({ participantId: "subject-participant" }),
      searchParams: Promise.resolve({}),
    });

    expect(treeContainsAction(page, "/api/admin/verification/roots")).toBe(false);
  });
});
