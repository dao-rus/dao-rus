import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signalPresentationDefaults } from "../../lib/signal-presentation";

const mocks = vi.hoisted(() => ({
  participant: vi.fn(),
  signals: vi.fn(),
  encounters: vi.fn(),
  texts: vi.fn(),
  types: vi.fn(),
  own: vi.fn(),
  matches: vi.fn(),
  keys: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.participant }));
vi.mock("@/lib/interface-texts", () => ({ readInterfaceTexts: mocks.texts }));
vi.mock("../../lib/signals", () => ({ listNetworkSignals: mocks.signals, listSignalTypes: mocks.types, listParticipantSignals: mocks.own }));
vi.mock("../../lib/closer", () => ({ listCloserMatches: mocks.matches, listOwnCloserKeys: mocks.keys,
  listCloserGoals: async () => [{ key: "friend", displayName: "Друг", asksGender: false, enabled: true }] }));
vi.mock("@/lib/relay", () => ({
  listRelayEncounters: mocks.encounters,
}));

import ExchangePage from "./page";
import { UserText } from "../../components/user-text";
import { SignalPreview } from "../../components/signal-preview";
import { SignalTypeIcon } from "../../components/signal-type-icon";

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join(" ");
  if (!isValidElement(node)) return "";
  if (node.type === UserText) return textContent(UserText(node.props as Parameters<typeof UserText>[0]));
  if (node.type === SignalPreview) return textContent(SignalPreview(node.props as Parameters<typeof SignalPreview>[0]));
  return textContent((node.props as { children?: ReactNode }).children);
}

function collectProps(node: ReactNode, matches: (props: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap((child) => collectProps(child, matches));
  if (!isValidElement(node)) return [];
  if (node.type === SignalPreview) return collectProps(SignalPreview(node.props as Parameters<typeof SignalPreview>[0]), matches);
  const props = node.props as Record<string, unknown>;
  return [...(matches(props) ? [props] : []), ...collectProps(props.children as ReactNode, matches)];
}

describe("network exchange catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.participant.mockResolvedValue({ id: "viewer" });
    mocks.encounters.mockResolvedValue([]);
    mocks.own.mockResolvedValue([]);
    mocks.matches.mockResolvedValue([]);
    mocks.keys.mockResolvedValue(new Map());
    mocks.types.mockResolvedValue(["need", "can", "want", "have"].map((key) => ({ key, displayName: key, enabled: true })));
    mocks.texts.mockResolvedValue({ values: {
      "exchange.title": "Обмен",
      "exchange.lead": "Здесь люди находят друг друга через потребности, возможности, знания, навыки, идеи и дела.",
      "exchange.privacy_hint": "Анонимные сигналы опубликованы без имени автора.",
      "exchange.empty": "Сигналов пока нет.",
      "exchange.tab_need": "? Нужно", "exchange.tab_can": "! Могу",
      "exchange.tab_want": "♥ Хочу", "exchange.tab_have": "+ Есть",
      "exchange.add_need": "Добавить «Мне нужно»", "exchange.add_can": "Добавить «Я могу»",
      "exchange.add_want": "Добавить «Я хочу»", "exchange.add_have": "Добавить «У меня есть»",
      "relay.list_title": "Диалоги", "signal.mine": "Ваш сигнал",
    } });
  });

  it("shows only safe text and own marker, and never offers self-response", async () => {
    mocks.signals.mockResolvedValue([
      { id: "own", kind: "need", label: "Мой запрос", mine: true, visibility: "network_blind", author: null },
      { id: "other", kind: "need", label: "Чужой запрос", mine: false, visibility: "network_blind", author: null },
    ]);
    const page = await ExchangePage({ searchParams: Promise.resolve({ tab: "need" }) });
    expect(textContent(page)).toContain("Мой запрос");
    expect(textContent(page)).toContain("Ваш сигнал");
    expect(textContent(page)).toContain("Чужой запрос");
    expect(collectProps(page, (props) => props.href === "/exchange/other")).toHaveLength(1);
    const responses = collectProps(page, (props) => props.action === "/api/relay");
    expect(responses).toHaveLength(1);
    expect(collectProps(responses[0].children as ReactNode, (props) => props.name === "signal_id")?.[0]?.value)
      .toBe("other");
    expect(collectProps(page, (props) => String(props.href ?? "").startsWith("/profile/"))).toHaveLength(0);
    expect(textContent(page)).toContain("Анонимные сигналы опубликованы без имени автора.");
  });

  it("opens Need by default and offers catalogue categories", async () => {
    mocks.signals.mockResolvedValue([]);
    const page = await ExchangePage({ searchParams: Promise.resolve({}) });
    expect(mocks.signals).toHaveBeenCalledWith("viewer", "need");
    for (const [kind, label] of [["need", "Нужно"], ["can", "Могу"],
      ["want", "Хочу"], ["have", "Есть"]]) {
      const link = collectProps(page, (props) => props.href === `/exchange?type=${kind}`)[0];
      expect(textContent(link.children as ReactNode).trim()).toBe(label);
      expect(link["aria-current"]).toBe(kind === "need" ? "page" : undefined);
    }
  });

  it("shows every enabled type with an icon in semantic order, without group headings or Relay inside the taxonomy", async () => {
    // The catalogue arrives ordered by machine key; navigation must not inherit that order.
    mocks.types.mockResolvedValue([...signalPresentationDefaults].sort((a, b) => a.key.localeCompare(b.key)).map((type) => ({
      key: type.key, displayName: type.name, enabled: true,
    })));
    mocks.signals.mockResolvedValue([]);
    const page = await ExchangePage({ searchParams: Promise.resolve({}) });
    const nav = collectProps(page, (props) => props["aria-label"] === "Типы сигналов")[0];
    expect(nav).toBeDefined();
    const links = collectProps(nav.children as ReactNode, (props) => typeof props.href === "string");
    expect(links.map((link) => link.href)).toEqual(signalPresentationDefaults.map((type) => `/exchange?type=${type.key}`));
    for (const type of signalPresentationDefaults) {
      const link = links.find((item) => item.href === `/exchange?type=${type.key}`)!;
      const icons = (link.children as ReactNode[]).filter((child) => isValidElement(child) && child.type === SignalTypeIcon);
      expect(icons.map((icon) => (icon as { props: { typeKey: string } }).props.typeKey), type.key).toEqual([type.key]);
    }
    expect(links.some((link) => link.href === "/relay")).toBe(false);
    expect(collectProps(page, (props) => props.href === "/relay")).toHaveLength(1);
    const text = textContent(page);
    for (const heading of ["Потребности и поиск", "Возможности и ресурсы", "Компетенции", "Намерения и деятельность", "Человеческие связи"]) {
      expect(text).not.toContain(heading);
    }
    expect(text).not.toContain("Анонимные сигналы опубликованы без имени автора.");
  });

  it.each(["need", "can", "want", "have"])("requests %s signals when selected", async (kind) => {
    mocks.signals.mockResolvedValue([]);
    await ExchangePage({ searchParams: Promise.resolve({ tab: kind }) });
    expect(mocks.signals).toHaveBeenCalledWith("viewer", kind);
  });

  it("shows a public author but never offers the anonymous Relay form for that record", async () => {
    mocks.signals.mockResolvedValue([{ id: "public", kind: "can", label: "Могу помочь", mine: false,
      visibility: "members", author: { id: "author", name: "Анна" } }]);
    const page = await ExchangePage({ searchParams: Promise.resolve({ tab: "can" }) });
    expect(textContent(page)).toContain("Могу помочь");
    expect(textContent(page)).toContain("Анна");
    expect(collectProps(page, (props) => props.href === "/profile/author")).toHaveLength(0);
    expect(collectProps(page, (props) => props.action === "/api/relay")).toHaveLength(0);
    expect(collectProps(page, (props) => props.href === "/exchange/public")).toHaveLength(1);
  });

  it("keeps the canonical link but suppresses a blind author's identity even if supplied", async () => {
    mocks.signals.mockResolvedValue([{ id: "blind", kind: "need", label: "Домик в деревне", mine: false,
      visibility: "network_blind", author: { id: "hidden", name: "Надежда К" } }]);
    const page = await ExchangePage({ searchParams: Promise.resolve({ type: "need" }) });
    expect(collectProps(page, (props) => props.href === "/exchange/blind")).toHaveLength(1);
    expect(collectProps(page, (props) => props.href === "/profile/hidden")).toHaveLength(0);
    expect(textContent(page)).not.toContain("Надежда К");
  });

  it("uses editable texts for the empty Have tab", async () => {
    mocks.signals.mockResolvedValue([]);
    mocks.texts.mockResolvedValue({ values: {
      "exchange.title": "Свои дела",
      "exchange.lead": "Новый вводный текст",
      "exchange.empty": "Список пуст",
      "exchange.privacy_hint": "Анонимность",
      "exchange.tab_need": "? Нужно", "exchange.tab_can": "! Могу",
      "exchange.tab_want": "♥ Хочу", "exchange.tab_have": "+ Есть",
      "exchange.add_have": "Добавить «У меня есть»",
      "relay.list_title": "Переписки",
    } });
    const page = await ExchangePage({ searchParams: Promise.resolve({ tab: "have" }) });
    expect(mocks.signals).toHaveBeenCalledWith("viewer", "have");
    const text = textContent(page);
    expect(text).toContain("Свои дела");
    expect(text).toContain("Новый вводный текст");
    expect(text).toContain("Список пуст");
    expect(text).toContain("Переписки");
    expect(text).not.toContain("Анонимных сигналов пока нет.");
  });
  it("renders a future enabled catalogue type and hides disabled ones", async () => {
    mocks.types.mockResolvedValue([
      { key: "need", displayName: "Нужно", enabled: true },
      { key: "future_type", displayName: "Будущий тип", enabled: true },
      { key: "disabled", displayName: "Скрытый тип", enabled: false },
    ]);
    mocks.signals.mockResolvedValue([{ id: "new", label: "Новое ядро", description: "Контекст", author: null }]);
    const page = await ExchangePage({ searchParams: Promise.resolve({ type: "future_type" }) });
    expect(mocks.signals).toHaveBeenCalledWith("viewer", "future_type");
    expect(textContent(page)).toContain("Будущий тип");
    expect(textContent(page)).toContain("Контекст");
    expect(textContent(page)).not.toContain("Скрытый тип");
    expect(collectProps(page, (props) => props.href === "/exchange/new?type=future_type")).toHaveLength(1);
    const futureLink = collectProps(page, (props) => props.href === "/exchange?type=future_type")[0];
    expect(textContent(futureLink.children as ReactNode)).toContain("Будущий тип");
  });
  it("shows Closer as own records plus identity-free matches, never as a network listing", async () => {
    mocks.types.mockResolvedValue([{ key: "need", displayName: "Нужно", enabled: true }, { key: "dating", displayName: "Знакомства", enabled: true }]);
    mocks.texts.mockResolvedValue({ values: { "exchange.title": "Обмен", "relay.list_title": "Диалоги",
      "exchange.closer_intro": "Запись скрыта от других участников.", "exchange.closer_own_title": "Ваши записи",
      "closer.no_keys": "Не участвует в подборе", "closer.draft": "Черновик", "closer.matches_title": "Совпадения",
      "closer.matches_empty": "Совпадений пока нет.", "closer.city_any": "Неважен", "closer.open_dialog": "Начать анонимный разговор",
      "closer.continue_dialog": "Открыть разговор", "signal.create": "Добавить", "exchange.empty": "Сигналов пока нет." } });
    mocks.own.mockResolvedValue([
      { id: "mine", typeKey: "dating", label: "Близкий друг", description: null, visibility: "match_only" },
      { id: "draft", typeKey: "dating", label: "Набросок", description: null, visibility: "private" },
      { id: "legacy", typeKey: "dating", label: "Старая запись", description: null, visibility: "match_only" },
      { id: "other-type", typeKey: "need", label: "Фотограф", description: null, visibility: "members" },
    ]);
    const friend = { goalKey: "friend", anyCity: false, selfGender: null, seeksGender: null };
    mocks.keys.mockResolvedValue(new Map([["mine", friend], ["draft", friend]]));
    mocks.matches.mockResolvedValue([
      { mySignalId: "mine", signalId: "theirs", goalName: "Друг", city: "Псков", label: "Ищу друга", description: "Подробности", encounterId: null },
      { mySignalId: "mine", signalId: "talking", goalName: "Друг", city: null, label: "Уже говорим", description: null, encounterId: "enc" },
    ]);
    const page = await ExchangePage({ searchParams: Promise.resolve({ type: "dating" }) });
    expect(mocks.signals).not.toHaveBeenCalled();
    expect(mocks.own).toHaveBeenCalledWith("viewer", "viewer");
    expect(mocks.matches).toHaveBeenCalledWith("viewer");
    const text = textContent(page);
    for (const shown of ["Запись скрыта от других участников.", "Близкий друг", "Друг", "Черновик", "Не участвует в подборе",
      "Ищу друга", "Псков", "Подробности", "Уже говорим", "Неважен"]) expect(text).toContain(shown);
    expect(text).not.toContain("Фотограф");
    expect(text).not.toContain("Сигналов пока нет.");
    // A match is neither a link to the record nor to anybody's profile; the only action is the anonymous dialog.
    expect(collectProps(page, (props) => ["/exchange/theirs", "/exchange/talking"].includes(String(props.href)))).toHaveLength(0);
    expect(collectProps(page, (props) => String(props.href ?? "").startsWith("/profile/"))).toHaveLength(0);
    const dialogs = collectProps(page, (props) => props.action === "/api/relay");
    expect(dialogs).toHaveLength(1);
    const field = (name: string) => collectProps(dialogs[0].children as ReactNode, (props) => props.name === name)[0]?.value;
    expect([field("action"), field("my_signal_id"), field("signal_id")]).toEqual(["closer_respond", "mine", "theirs"]);
    expect(collectProps(page, (props) => props.href === "/relay/enc")).toHaveLength(1);
    expect(collectProps(page, (props) => props.href === "/exchange/new?type=dating")).toHaveLength(1);
  });
  it.each(["unknown", "../../private", "disabled"])("falls back safely for %s type queries", async (type) => {
    mocks.signals.mockResolvedValue([]);
    await ExchangePage({ searchParams: Promise.resolve({ type }) });
    expect(mocks.signals).toHaveBeenCalledWith("viewer", "need");
  });

});
