import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentParticipant: vi.fn(),
  listParticipantsDirectory: vi.fn(),
  readInterfaceTexts: vi.fn(),
  listCommunityPosts: vi.fn(),
  listCommunitySignals: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/session", () => ({
  getCurrentParticipant: mocks.getCurrentParticipant,
}));
vi.mock("@/lib/participants-directory", () => ({
  listParticipantsDirectory: mocks.listParticipantsDirectory,
}));
vi.mock("@/lib/interface-texts", () => ({ readInterfaceTexts: mocks.readInterfaceTexts }));
vi.mock("@/lib/communities", () => ({
  communityFromParams: (params: { interest?: string; residence_name?: string; residence_type?: string; residence_country?: string }) =>
    params.interest?.trim() ? { type: "interest", interest: params.interest.trim() }
      : params.residence_name && params.residence_type && params.residence_country
        ? { type: "residence", residence: { name: params.residence_name, type: params.residence_type, country: params.residence_country } }
        : null,
  communityHref: (community: { type: string; interest?: string; residence?: { name: string; type: string; country: string } }) =>
    community.type === "interest" ? `/participants?interest=${encodeURIComponent(community.interest ?? "")}`
      : `/participants?${new URLSearchParams({ residence_name: community.residence!.name,
        residence_type: community.residence!.type, residence_country: community.residence!.country })}`,
  listCommunityPosts: mocks.listCommunityPosts,
  listCommunitySignals: mocks.listCommunitySignals,
}));
vi.mock("@/lib/profile-about", () => ({
  normalizeResidence: ({ name, type, country }: { name: string; type: string; country: string }) =>
    name && type && country ? { name: name.trim(), type: type.trim(), country: country.trim() } : null,
  residenceLabel: ({ name, country }: { name: string; country: string }) => `${name}, ${country}`,
}));
vi.mock("@/components/telegram-avatar", () => ({ TelegramAvatar: () => null }));
vi.mock("@/components/local-date-time", () => ({ LocalDateTime: () => null }));

import ParticipantsPage from "./page";

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join(" ");
  if (!isValidElement(node)) return "";
  return textContent((node.props as { children?: ReactNode }).children);
}

function hrefs(node: ReactNode): string[] {
  if (Array.isArray(node)) return node.flatMap(hrefs);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode; href?: string };
  return [...(props.href ? [props.href] : []), ...hrefs(props.children)];
}

function classNames(node: ReactNode): string[] {
  if (Array.isArray(node)) return node.flatMap(classNames);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode; className?: string };
  return [...(props.className ? [props.className] : []), ...classNames(props.children)];
}

describe("/participants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redirect.mockImplementation((destination: string) => {
      throw new Error(`redirect:${destination}`);
    });
    mocks.readInterfaceTexts.mockResolvedValue({ values: {
      "participants.title": "Сеть", "community.members_title": "Участники",
      "community.residence_title": "Сообщество", "community.interest_title": "Сообщество",
      "community.feed_title": "Объявления", "community.feed_empty": "Пусто",
      "participants.sort_label": "Сортировка:", "participants.sort_name": "Имя",
      "participants.sort_verification": "Топ-верификация",
      "participants.sort_reputation": "Топ-репутация",
    } });
    mocks.listCommunityPosts.mockResolvedValue([]);
    mocks.listCommunitySignals.mockResolvedValue([]);
  });

  it("requires an authenticated Participant", async () => {
    mocks.getCurrentParticipant.mockResolvedValue(null);

    await expect(ParticipantsPage({ searchParams: Promise.resolve({}) }))
      .rejects.toThrow("redirect:/");
    expect(mocks.listParticipantsDirectory).not.toHaveBeenCalled();
    expect(mocks.readInterfaceTexts).not.toHaveBeenCalled();
  });

  it("shows only public Core profile fields and forwards search", async () => {
    const participantId = "10000000-0000-4000-8000-000000000001";
    mocks.getCurrentParticipant.mockResolvedValue({ id: "viewer" });
    mocks.listParticipantsDirectory.mockResolvedValue([
      {
        participantId,
        displayName: "Алиса",
        telegramUsername: "alice",
        telegramBio: "Биография Алисы",
        telegramPhoneNumber: "+79990000000",
        verificationPoints: 2, positiveCount: 3,
      },
      {
        participantId: "20000000-0000-4000-8000-000000000002",
        displayName: "Борис",
        telegramUsername: null,
        verificationPoints: 0, positiveCount: 0,
      },
    ]);

    const page = await ParticipantsPage({
      searchParams: Promise.resolve({ q: "alice" }),
    });
    const text = textContent(page);

    expect(mocks.listParticipantsDirectory).toHaveBeenCalledWith("alice", { interest: "", residence: null, viewerParticipantId: "viewer" });
    expect(text).toContain("Сеть");
    expect(text).toContain("Алиса");
    expect(text).toContain("@alice");
    expect(text).toContain("Биография Алисы");
    expect(text).not.toContain("+79990000000");
    expect(text).not.toContain('Подтвердили:');
    expect(hrefs(page)).toContain("/");
    expect(hrefs(page)).toContain("/veche");
    expect(text).not.toContain(participantId);
    expect(text).not.toContain("Telegram ID");
    expect(text).not.toContain("Статус в ДАО");
    expect(text).not.toContain("Последний раз в Telegram");
    expect(hrefs(page)).toContain(`/profile/${participantId}`);
    expect(hrefs(page)).not.toContain("/admin/participants");
  });

  it("shows the overridden section title", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "viewer" });
    mocks.listParticipantsDirectory.mockResolvedValue([]);
    mocks.readInterfaceTexts.mockResolvedValue({ values: { "participants.title": "Моя сеть" } });

    const page = await ParticipantsPage({ searchParams: Promise.resolve({}) });

    expect(textContent(page)).toContain("Моя сеть");
  });

  it("shows sort links below search and preserves search and community filters", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "viewer" });
    mocks.listParticipantsDirectory.mockResolvedValue([]);
    const page = await ParticipantsPage({ searchParams: Promise.resolve({
      q: "Анна", interest: "история", sort: "verification",
    }) });
    expect(mocks.listParticipantsDirectory).toHaveBeenCalledWith("Анна", {
      interest: "история", residence: null, viewerParticipantId: "viewer", sort: "verification",
    });
    expect(textContent(page)).toContain("Имя");
    expect(textContent(page)).toContain("Топ-верификация");
    expect(textContent(page)).toContain("Топ-репутация");
    expect(hrefs(page)).toContain("/participants?interest=%D0%B8%D1%81%D1%82%D0%BE%D1%80%D0%B8%D1%8F&q=%D0%90%D0%BD%D0%BD%D0%B0");
    expect(hrefs(page)).toContain("/participants?interest=%D0%B8%D1%81%D1%82%D0%BE%D1%80%D0%B8%D1%8F&q=%D0%90%D0%BD%D0%BD%D0%B0&sort=reputation");
    expect(hrefs(page)).toContain("/participants?interest=%D0%B8%D1%81%D1%82%D0%BE%D1%80%D0%B8%D1%8F&sort=verification");
  });

  it("shows an interest filter and preserves it while searching by name", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "viewer" });
    mocks.listParticipantsDirectory.mockResolvedValue([]);

    const page = await ParticipantsPage({
      searchParams: Promise.resolve({ q: "Анна", interest: " История " }),
    });

    expect(mocks.listParticipantsDirectory).toHaveBeenCalledWith("Анна", {
      interest: "История", residence: null, viewerParticipantId: "viewer",
    });
    expect(textContent(page)).toMatch(/Интерес:\s+История/);
    expect(textContent(page)).toContain("Сообщество: История");
    expect(textContent(page)).not.toContain("Сообщество интереса");
    expect(hrefs(page)).toContain("/participants?interest=%D0%98%D1%81%D1%82%D0%BE%D1%80%D0%B8%D1%8F");
    expect(hrefs(page)).toContain("/participants");
    expect(mocks.listCommunityPosts).toHaveBeenCalledWith({ type: "interest", interest: "История" });
  });

  it("puts community members and announcements in columns with compact member identities", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "viewer" });
    mocks.listParticipantsDirectory.mockResolvedValue([{
      participantId: "member", displayName: "Анна", telegramUsername: "anna",
      telegramBio: "Биография", residence: { name: "Казань", type: "город", country: "Россия" },
      verificationPoints: 2, positiveCount: 3,
    }]);
    const page = await ParticipantsPage({ searchParams: Promise.resolve({ interest: "история" }) });
    const text = textContent(page);
    expect(classNames(page)).toContain("communityColumns");
    expect(classNames(page)).toContain("communityMembers");
    expect(classNames(page)).toContain("communityFeed");
    expect(text).toContain("Анна");
    expect(text).not.toContain("@anna");
    expect(text).not.toContain("Биография");
    expect(text).not.toContain("Открыть профиль");
    expect(text).toContain("Объявления");
  });

  it("filters the directory by residence and keeps that filter in name search", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "viewer" });
    mocks.listParticipantsDirectory.mockResolvedValue([{ participantId: "owner", displayName: "Анна",
      residence: { name: "Казань", type: "город", country: "Россия" }, verificationPoints: 0,
    }]);

    const page = await ParticipantsPage({ searchParams: Promise.resolve({
      q: "Анна", residence_name: "Казань", residence_type: "город", residence_country: "Россия",
    }) });

    expect(mocks.listParticipantsDirectory).toHaveBeenCalledWith("Анна", {
      interest: "", residence: { name: "Казань", type: "город", country: "Россия" }, viewerParticipantId: "viewer",
    });
    expect(textContent(page)).toMatch(/Место жительства:\s+Казань, Россия/);
    expect(textContent(page)).toContain("Сообщество Казань, Россия");
    expect(textContent(page)).not.toContain("Сообщество места");
    expect(hrefs(page)).toContain("/participants?residence_name=%D0%9A%D0%B0%D0%B7%D0%B0%D0%BD%D1%8C&residence_type=%D0%B3%D0%BE%D1%80%D0%BE%D0%B4&residence_country=%D0%A0%D0%BE%D1%81%D1%81%D0%B8%D1%8F");
    expect(mocks.listCommunitySignals).toHaveBeenCalledWith(["owner"], "viewer");
    expect(textContent(page)).toContain("Я хочу");
    expect(textContent(page)).toContain("У меня есть");
  });
});
