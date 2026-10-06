import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  participant: vi.fn(),
  signals: vi.fn(),
  encounters: vi.fn(),
  texts: vi.fn(),
  types: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.participant }));
vi.mock("@/lib/interface-texts", () => ({ readInterfaceTexts: mocks.texts }));
vi.mock("../../lib/signals", () => ({ listNetworkSignals: mocks.signals, listSignalTypes: mocks.types }));
vi.mock("@/lib/relay", () => ({
  listRelayEncounters: mocks.encounters,
}));

import ExchangePage from "./page";

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join(" ");
  if (!isValidElement(node)) return "";
  return textContent((node.props as { children?: ReactNode }).children);
}

function collectProps(node: ReactNode, matches: (props: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap((child) => collectProps(child, matches));
  if (!isValidElement(node)) return [];
  const props = node.props as Record<string, unknown>;
  return [...(matches(props) ? [props] : []), ...collectProps(props.children as ReactNode, matches)];
}

describe("network exchange catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.participant.mockResolvedValue({ id: "viewer" });
    mocks.encounters.mockResolvedValue([]);
    mocks.types.mockResolvedValue(["need", "can", "want", "have"].map((key) => ({ key, displayName: key, enabled: true })));
    mocks.texts.mockResolvedValue({ values: {
      "exchange.title": "Обмен",
      "exchange.lead": "Сначала — дело, потом — знакомство. Контакты открываются только по взаимному согласию.",
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
  });

  it("opens Need by default and offers catalogue categories", async () => {
    mocks.signals.mockResolvedValue([]);
    const page = await ExchangePage({ searchParams: Promise.resolve({}) });
    expect(mocks.signals).toHaveBeenCalledWith("viewer", "need");
    for (const [kind, label] of [["need", "? Нужно"], ["can", "! Могу"],
      ["want", "♥ Хочу"], ["have", "+ Есть"]]) {
      const link = collectProps(page, (props) => props.href === `/exchange?type=${kind}`)[0];
      expect(textContent(link.children as ReactNode)).toBe(label);
      expect(link["aria-current"]).toBe(kind === "need" ? "page" : undefined);
    }
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
    expect(collectProps(page, (props) => props.href === "/profile/author")).toHaveLength(1);
    expect(collectProps(page, (props) => props.action === "/api/relay")).toHaveLength(0);
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
  });
  it.each(["unknown", "../../private", "disabled"])("falls back safely for %s type queries", async (type) => {
    mocks.signals.mockResolvedValue([]);
    await ExchangePage({ searchParams: Promise.resolve({ type }) });
    expect(mocks.signals).toHaveBeenCalledWith("viewer", "need");
  });

});
