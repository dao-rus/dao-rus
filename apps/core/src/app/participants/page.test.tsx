import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentParticipant: vi.fn(),
  listParticipantsDirectory: vi.fn(),
  readInterfaceTexts: vi.fn(),
  listCommunityPosts: vi.fn(),
  listCommunitySignals: vi.fn(),
  isParticipantsDirectoryEnabled: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/session", () => ({
  getCurrentParticipant: mocks.getCurrentParticipant,
}));
vi.mock("@/lib/config", () => ({ isParticipantsDirectoryEnabled: mocks.isParticipantsDirectoryEnabled }));
vi.mock("@/lib/participants-directory", () => ({
  listParticipantsDirectory: mocks.listParticipantsDirectory,
}));
vi.mock("@/lib/interface-texts", () => ({ readInterfaceTexts: mocks.readInterfaceTexts }));
vi.mock("@/lib/communities", async () => ({
  ...await import("../../lib/communities"),
  listCommunityPosts: mocks.listCommunityPosts,
  listCommunitySignals: mocks.listCommunitySignals,
}));
vi.mock("@/lib/profile-about", async () => await import("../../lib/profile-about"));
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

function linkProps(node: ReactNode): Array<{ href: string; title?: string; "aria-label"?: string }> {
  if (Array.isArray(node)) return node.flatMap(linkProps);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode; href?: string; title?: string; "aria-label"?: string };
  return [...(props.href ? [{ href: props.href, title: props.title, "aria-label": props["aria-label"] }] : []),
    ...linkProps(props.children)];
}

function classNames(node: ReactNode): string[] {
  if (Array.isArray(node)) return node.flatMap(classNames);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode; className?: string };
  return [...(props.className ? [props.className] : []), ...classNames(props.children)];
}

function hasMainNavigation(node: ReactNode): boolean {
  if (Array.isArray(node)) return node.some(hasMainNavigation);
  if (!isValidElement(node)) return false;
  const props = node.props as { current?: string; children?: ReactNode };
  return props.current === "participants" || hasMainNavigation(props.children);
}

describe("/participants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isParticipantsDirectoryEnabled.mockReturnValue(true);
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
      "participants.sort_joined": "Дата вступления",
      "participants.sort_joined_oldest": "Сначала старые",
      "participants.sort_joined_newest": "Сначала новые",
      "participants.sort_core": "Ядро",
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

  it("redirects participants while the directory is disabled", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "viewer" });
    mocks.isParticipantsDirectoryEnabled.mockReturnValue(false);

    await expect(ParticipantsPage({ searchParams: Promise.resolve({ q: "Анна", sort: "core" }) }))
      .rejects.toThrow("redirect:/");
    expect(mocks.listParticipantsDirectory).not.toHaveBeenCalled();
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
        profileAge: null, profileCity: null, profileOccupation: null, profileEducation: null, profileFamilyStatus: null,
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
    expect(text).not.toContain("Биография Алисы");
    expect(text).not.toContain("Род занятий");
    expect(text).not.toContain("+79990000000");
    expect(text).not.toContain('Подтвердили:');
    expect(hasMainNavigation(page)).toBe(true);
    expect(text).not.toContain(participantId);
    expect(text).not.toContain("Telegram ID");
    expect(text).not.toContain("Статус в ДАО");
    expect(text).not.toContain("Последний раз в Telegram");
    // The name itself links to the profile (ParticipantName); the separate button is gone.
    expect(textContent(page)).not.toContain("Открыть профиль");
    expect(hrefs(page)).not.toContain("/admin/participants");
  });

  it("shows only filled profile facts and keeps a card without facts", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "viewer" });
    mocks.listParticipantsDirectory.mockResolvedValue([
      { participantId: "viewer", displayName: "Анна", telegramUsername: null, verificationPoints: 0, positiveCount: 0,
        profileAge: 46, profileCity: "Самара", profileOccupation: "Программист", profileEducation: null, profileFamilyStatus: null },
      { participantId: "empty", displayName: "Борис", telegramUsername: null, verificationPoints: 0, positiveCount: 0,
        profileAge: null, profileCity: null, profileOccupation: null, profileEducation: null, profileFamilyStatus: null },
    ]);

    const page = await ParticipantsPage({ searchParams: Promise.resolve({}) });
    const text = textContent(page);

    expect(text).toContain("Анна");
    expect(text).toContain("Самара");
    expect(text).toContain("Программист");
    expect(text).toContain("Возраст");
    expect(text).toContain("Борис");
    expect(text).not.toContain("Образование");
    expect(text).not.toContain("Семейное положение");
  });

  it("shows only nonzero signal indicators and links them to profile anchors", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "viewer" });
    mocks.listParticipantsDirectory.mockResolvedValue([{
      participantId: "member", displayName: "Анна", verificationPoints: 0, positiveCount: 0,
      signalCounts: { need: 2, can: 0, want: 1, have: 4 },
      signals: [{ body: "Скрытый текст сигнала" }],
    }]);
    const page = await ParticipantsPage({ searchParams: Promise.resolve({}) });
    const indicators = linkProps(page).filter(({ href }) => href.startsWith("/profile/member#signal-"));
    expect(indicators).toEqual([
      { href: "/profile/member#signal-need", title: "Нужно", "aria-label": "Нужно: 2" },
      { href: "/profile/member#signal-want", title: "Хочу", "aria-label": "Хочу: 1" },
      { href: "/profile/member#signal-have", title: "Есть", "aria-label": "Есть: 4" },
    ]);
    expect(textContent(page)).not.toContain("Скрытый текст сигнала");
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
    expect(textContent(page)).toContain("Ядро");
    expect(hrefs(page)).toContain("/participants?interest=%D0%B8%D1%81%D1%82%D0%BE%D1%80%D0%B8%D1%8F&q=%D0%90%D0%BD%D0%BD%D0%B0");
    expect(hrefs(page)).toContain("/participants?interest=%D0%B8%D1%81%D1%82%D0%BE%D1%80%D0%B8%D1%8F&q=%D0%90%D0%BD%D0%BD%D0%B0&sort=reputation");
    expect(hrefs(page)).toContain("/participants?interest=%D0%B8%D1%81%D1%82%D0%BE%D1%80%D0%B8%D1%8F&q=%D0%90%D0%BD%D0%BD%D0%B0&sort=core");
    expect(hrefs(page)).toContain("/participants?interest=%D0%B8%D1%81%D1%82%D0%BE%D1%80%D0%B8%D1%8F&sort=verification");
  });

  it.each([undefined, "asc", "desc"] as const)("preserves joined direction %s and filters in links", async (dir) => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "viewer" });
    mocks.listParticipantsDirectory.mockResolvedValue([]);
    const page = await ParticipantsPage({ searchParams: Promise.resolve({
      q: "Анна", interest: "история", residence_name: "Казань", residence_type: "город",
      residence_country: "Россия", sort: "joined", dir,
    }) });
    const direction = dir ?? "asc";
    expect(mocks.listParticipantsDirectory).toHaveBeenCalledWith("Анна", expect.objectContaining({ sort: "joined", dir: direction }));
    expect(textContent(page)).toContain("Сначала старые");
    expect(textContent(page)).toContain("Сначала новые");
    function directionLinks(node: ReactNode): Array<{ href: string; current?: string; text: string }> {
      if (Array.isArray(node)) return node.flatMap(directionLinks);
      if (!isValidElement(node)) return [];
      const props = node.props as { href?: string; children?: ReactNode; "aria-current"?: string };
      const text = textContent(props.children);
      return [...(props.href && (text === "Сначала старые" || text === "Сначала новые")
        ? [{ href: props.href, current: props["aria-current"], text }] : []), ...directionLinks(props.children)];
    }
    const links = directionLinks(page);
    expect(links).toHaveLength(2);
    links.forEach((link, index) => {
      const query = new URL(link.href, "https://core.daorus.org").searchParams;
      expect(Object.fromEntries(query)).toEqual({ q: "Анна", interest: "история", residence_name: "Казань",
        residence_type: "город", residence_country: "Россия", sort: "joined", dir: index === 0 ? "asc" : "desc" });
      expect(link.current).toBe(query.get("dir") === direction ? "page" : undefined);
    });
    hrefs(page).filter((href) => href.startsWith("/participants?")).forEach((href) => {
      const query = new URL(href, "https://core.daorus.org").searchParams;
      if (query.get("sort") !== "joined") expect(query.has("dir")).toBe(false);
    });
  });

  it("hides joined direction and ignores dir for other sorts", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "viewer" });
    mocks.listParticipantsDirectory.mockResolvedValue([]);
    const page = await ParticipantsPage({ searchParams: Promise.resolve({ sort: "reputation", dir: "desc" }) });
    expect(textContent(page)).not.toContain("Сначала старые");
    expect(textContent(page)).not.toContain("Сначала новые");
    expect(mocks.listParticipantsDirectory).toHaveBeenCalledWith("", expect.not.objectContaining({ dir: expect.anything() }));
    expect(hrefs(page)).toContain("/participants?sort=joined&dir=asc");
    hrefs(page).forEach((href) => {
      const query = new URL(href, "https://core.daorus.org").searchParams;
      if (query.get("sort") !== "joined") expect(query.has("dir")).toBe(false);
    });
  });

  it("shows the count of found Core visitors", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "viewer" });
    mocks.listParticipantsDirectory.mockResolvedValue([{
      participantId: "core-member", displayName: "Анна", telegramUsername: null,
      verificationPoints: 0, positiveCount: 0,
    }]);

    const page = await ParticipantsPage({ searchParams: Promise.resolve({ sort: "core" }) });

    expect(mocks.listParticipantsDirectory).toHaveBeenCalledWith("", {
      interest: "", residence: null, viewerParticipantId: "viewer", sort: "core",
    });
    expect(textContent(page)).toMatch(/Найдено\s*:\s*1\s*\./);
    expect(hrefs(page)).toContain("/participants?sort=core");
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
    mocks.listCommunitySignals.mockResolvedValue([
      { participantId: "owner", kind: "want", body: "Ищу друзей" },
      { participantId: "owner", kind: "have", body: "Могу помочь с ремонтом" },
    ]);

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
    expect(textContent(page)).not.toContain("Мне нужно");
    expect(textContent(page)).not.toContain("Я могу");
    expect(textContent(page)).not.toContain("Пока не указано.");
  });

  it("keeps the participant card but hides empty and unavailable exchange fields", async () => {
    mocks.getCurrentParticipant.mockResolvedValue({ id: "viewer" });
    mocks.listParticipantsDirectory.mockResolvedValue([{ participantId: "owner", displayName: "Анна",
      residence: { name: "Казань", type: "город", country: "Россия" }, verificationPoints: 0,
    }]);
    mocks.listCommunitySignals.mockResolvedValue([
      { participantId: "owner", kind: "want", body: "   " },
    ]);

    const page = await ParticipantsPage({ searchParams: Promise.resolve({
      residence_name: "Казань", residence_type: "город", residence_country: "Россия",
    }) });
    const text = textContent(page);

    expect(text).toContain("Анна");
    expect(text).not.toContain("Я хочу");
    expect(text).not.toContain("Мне нужно");
    expect(text).not.toContain("Я могу");
    expect(text).not.toContain("У меня есть");
    expect(text).not.toContain("Пока не указано.");
    expect(classNames(page)).not.toContain("communitySignals");
  });
});

vi.mock("@/lib/award-views", () => ({ getAwardBadges: vi.fn().mockResolvedValue({}), getOwnAwardOffers: vi.fn().mockResolvedValue([]) }));

describe("residence communities with the general directory disabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isParticipantsDirectoryEnabled.mockReturnValue(false);
    mocks.getCurrentParticipant.mockResolvedValue({ id: "viewer" });
    mocks.redirect.mockImplementation((destination: string) => { throw new Error(`redirect:${destination}`); });
    mocks.listParticipantsDirectory.mockResolvedValue([]);
    mocks.listCommunityPosts.mockResolvedValue([]);
    mocks.listCommunitySignals.mockResolvedValue([]);
    mocks.readInterfaceTexts.mockResolvedValue({ values: { "community.residence_title": "Сообщество" } });
  });
  it("opens a complete residence community for a signed-in viewer", async () => {
    const page = await ParticipantsPage({ searchParams: Promise.resolve({ residence_name: "Казань", residence_type: "город", residence_country: "Россия" }) });
    expect(textContent(page)).toContain("Казань");
    expect(mocks.listParticipantsDirectory).toHaveBeenCalledWith("", expect.objectContaining({ residence: { name: "Казань", type: "город", country: "Россия" } }));
  });
  it.each([{}, { q: "Анна" }, { residence_name: "Казань" }, { interest: "   " }, { interest: "x".repeat(81) },
    { interest: "История", residence_name: "Казань" }])("does not open the general catalogue for %j", async params => {
    await expect(ParticipantsPage({ searchParams: Promise.resolve(params) })).rejects.toThrow("redirect:/");
    expect(mocks.listParticipantsDirectory).not.toHaveBeenCalled();
  });
  it("does not open residence communities to guests", async () => {
    mocks.getCurrentParticipant.mockResolvedValue(null);
    await expect(ParticipantsPage({ searchParams: Promise.resolve({ residence_name: "Казань", residence_type: "город", residence_country: "Россия" }) })).rejects.toThrow("redirect:/");
    expect(mocks.listParticipantsDirectory).not.toHaveBeenCalled();
  });
  it("opens an interest intersection and keeps search, sorting and reset within it", async () => {
    const page = await ParticipantsPage({ searchParams: Promise.resolve({ interest: " История & культура ", q: "Анна", sort: "joined", dir: "desc" }) });
    expect(mocks.listParticipantsDirectory).toHaveBeenCalledWith("Анна", expect.objectContaining({ interest: "История & культура", viewerParticipantId: "viewer" }));
    const urls = hrefs(page).filter(href => href.startsWith("/participants"));
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every(href => new URL(href, "https://core.daorus.org").searchParams.get("interest") === "История & культура")).toBe(true);
    expect(textContent(page)).not.toContain("Показать всех");
  });
  it("does not open interest intersections to guests", async () => {
    mocks.getCurrentParticipant.mockResolvedValue(null);
    await expect(ParticipantsPage({ searchParams: Promise.resolve({ interest: "История" }) })).rejects.toThrow("redirect:/");
    expect(mocks.listParticipantsDirectory).not.toHaveBeenCalled();
    expect(mocks.listCommunityPosts).not.toHaveBeenCalled();
  });
});

describe("unspecified residence list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isParticipantsDirectoryEnabled.mockReturnValue(false);
    mocks.getCurrentParticipant.mockResolvedValue({ id: "viewer" });
    mocks.redirect.mockImplementation((destination: string) => { throw new Error(`redirect:${destination}`); });
    mocks.listParticipantsDirectory.mockResolvedValue([]);
    mocks.readInterfaceTexts.mockResolvedValue({ values: { "nearby.unspecified": "Не указавшие", "nearby.unspecified_empty": "Все указали" } });
  });
  it("uses the missing residence filter and preserves it in search, reset and sort links", async () => {
    const page = await ParticipantsPage({ searchParams: Promise.resolve({ without_residence: "1", q: "Анна", sort: "joined", dir: "desc" }) });
    expect(textContent(page)).toContain("Не указавшие");
    expect(mocks.listParticipantsDirectory).toHaveBeenCalledWith("Анна", expect.objectContaining({ withoutResidence: true, sort: "joined", dir: "desc" }));
    const urls = hrefs(page).filter(href => href.startsWith("/participants"));
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every(href => new URL(href, "https://core.daorus.org").searchParams.get("without_residence") === "1")).toBe(true);
    function inputs(node: ReactNode): Array<{ name?: string; value?: string }> {
      if (Array.isArray(node)) return node.flatMap(inputs);
      if (!isValidElement(node)) return [];
      const props = node.props as { children?: ReactNode; name?: string; value?: string };
      return [...(node.type === "input" ? [props] : []), ...inputs(props.children)];
    }
    expect(inputs(page)).toContainEqual(expect.objectContaining({ name: "without_residence", value: "1" }));
    expect(mocks.listCommunityPosts).not.toHaveBeenCalled();
    expect(mocks.listCommunitySignals).not.toHaveBeenCalled();
  });
  it.each([{}, { without_residence: "0" }, { without_residence: "1", residence_name: "Москва" }, { without_residence: "1", interest: "История" }])("does not allow an unfiltered catalogue via %j", async params => {
    await expect(ParticipantsPage({ searchParams: Promise.resolve(params) })).rejects.toThrow("redirect:/");
    expect(mocks.listParticipantsDirectory).not.toHaveBeenCalled();
  });
  it("requires authentication", async () => {
    mocks.getCurrentParticipant.mockResolvedValue(null);
    await expect(ParticipantsPage({ searchParams: Promise.resolve({ without_residence: "1" }) })).rejects.toThrow("redirect:/");
    expect(mocks.listParticipantsDirectory).not.toHaveBeenCalled();
  });
});
