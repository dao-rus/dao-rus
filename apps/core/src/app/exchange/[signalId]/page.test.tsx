import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NetworkSignal } from "../../../lib/signals";

const mocks = vi.hoisted(() => ({ participant: vi.fn(), signal: vi.fn(), guest: vi.fn(),
  types: vi.fn(), texts: vi.fn(), reaction: vi.fn(), publicLikes: vi.fn() }));
vi.mock("../../../lib/session", () => ({ getCurrentParticipant: mocks.participant }));
vi.mock("../../../lib/signals", () => ({ getSignal: mocks.signal,
  getGuestShareableSignal: mocks.guest, listSignalTypes: mocks.types }));
vi.mock("../../../lib/signal-reactions", () => ({ readSignalReactionState: mocks.reaction,
  readPublicSignalReactionCount: mocks.publicLikes }));
vi.mock("../../../lib/interface-texts", async (original) => ({
  ...await original<typeof import("../../../lib/interface-texts")>(), readInterfaceTexts: mocks.texts,
}));
vi.mock("../../../components/core-navigation", () => ({ CoreNavigation: () => <nav>Core menu</nav> }));
vi.mock("../../../components/signal-share-action", () => ({ SignalShareAction: ({ payload, labels }: {
  payload: { label: string; description: string | null; url: string }; labels: { share: string };
}) => <button data-share-url={payload.url} data-share-label={payload.label}
  data-share-description={payload.description ?? ""}>{labels.share}</button> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); } }));

import Page, { generateMetadata } from "./page";
import { interfaceTextFields } from "../../../lib/interface-texts";

const id = "10000000-0000-4000-8000-000000000001";
const signal: NetworkSignal = { id, ownerId: "hidden-owner-id", typeKey: "need",
  label: "Ищу работу в СПб", description: "Нужен уважительный коллектив.", visibility: "public", status: "active",
  legacyBody: false, createdAt: new Date(), updatedAt: new Date(), mine: false,
  author: { id: "hidden-owner-id", name: "Надежда К" } };
const guestSignal = { id, typeKey: "need", label: signal.label, description: signal.description,
  authorName: "Надежда К" };
const props = { params: Promise.resolve({ signalId: id }) };
async function html() { return renderToStaticMarkup(await Page(props)); }

beforeEach(() => {
  vi.clearAllMocks();
  mocks.participant.mockResolvedValue({ id: "viewer" });
  mocks.signal.mockResolvedValue(signal);
  mocks.guest.mockResolvedValue(null);
  mocks.types.mockResolvedValue([{ key: "need", displayName: "Нужно", enabled: true }]);
  mocks.texts.mockResolvedValue({ values: Object.fromEntries(interfaceTextFields.map((field) => [field.key, field.defaultValue])) });
  mocks.reaction.mockResolvedValue({ count: 2, reacted: false });
  mocks.publicLikes.mockResolvedValue(3);
});

describe("canonical Signal card", () => {
  it("shows a permitted member card with separate label, description, author and reaction", async () => {
    const output = await html();
    expect(mocks.signal).toHaveBeenCalledWith("viewer", id);
    expect(output).toContain('class="signalCardLabel"');
    expect(output).toContain("Ищу работу в СПб");
    expect(output).toContain('class="signalCardDescription"');
    expect(output).toContain("Нужен уважительный коллектив.");
    expect(output).toContain('class="signalCardAuthor"');
    expect(output).toContain('href="/profile/hidden-owner-id"');
    expect(output).toContain("♥ 2");
    expect(output).not.toContain("Полезно");
    expect(output).not.toContain("Поддержать сеть");
    expect(output).not.toContain("Перевод токенов на поддержку сети пока недоступен.");
    expect(output).toContain("Перейти к автору");
    expect(output).toContain(`data-share-url="http://localhost:3000/exchange/${id}"`);
    expect(output).toContain("← К обмену");
    expect(output.indexOf("Перейти к автору")).toBeLessThan(output.indexOf("♥ 2"));
    expect(output.indexOf("♥ 2")).toBeLessThan(output.indexOf("data-share-url"));
  });

  it("shows owner edit, archive and share, without self reaction or external-share UX", async () => {
    mocks.signal.mockResolvedValue({ ...signal, mine: true });
    const output = await html();
    expect(output).toContain(`/exchange/new?signal=${id}`);
    expect(output).toContain('value="archive_signal"');
    expect(output).toContain("data-share-url=");
    expect(output).not.toContain("♥");
    expect(output).not.toContain("confirm_external_share");
    expect(output).not.toContain("внешнюю ссылку");
    expect(output).not.toContain("Внешняя ссылка недоступна");
    expect(output).not.toContain('action="/api/relay"');
  });

  it.each(["private", "circle", "match_only"])("does not offer Share for an owner's %s Signal", async (visibility) => {
    mocks.signal.mockResolvedValue({ ...signal, mine: true, visibility });
    const output = await html();
    expect(output).not.toContain("data-share-url=");
    expect(output).not.toContain("Внешняя ссылка");
  });

  it("never renders blind identity, even if a malformed adapter supplies it", async () => {
    mocks.signal.mockResolvedValue({ ...signal, visibility: "network_blind", typeKey: "need",
      author: { id: "hidden-owner-id", name: "Надежда К" } });
    const output = await html();
    expect(output).toContain('action="/api/relay"');
    expect(output).toContain("Откликнуться");
    expect(output).toContain("♥ 2");
    expect(output).toContain("data-share-url=");
    expect(output).not.toContain("hidden-owner-id");
    expect(output).not.toContain("Надежда К");
  });

  it("renders a minimal guest card: brand, label, description, author, like, then Share", async () => {
    mocks.participant.mockResolvedValue(null);
    mocks.guest.mockResolvedValue(guestSignal);
    const output = await html();
    expect(output.match(/ДАО Русь/g)).toHaveLength(1);
    expect(output).toContain('class="signalGuestHeader"');
    expect(output).toContain('href="/">ДАО Русь</a>');
    const order = ["ДАО Русь", "Ищу работу в СПб", "Нужен уважительный коллектив.", "Надежда К", "♥ 3", "Поделиться"]
      .map((text) => output.indexOf(text));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(output).toContain('class="signalGuestLike"');
    expect(output).toContain('class="signalGuestShare"');
    expect(output).toContain(`data-share-url="http://localhost:3000/exchange/${id}"`);
    expect(output).toContain('data-share-label="Ищу работу в СПб"');
    for (const hidden of ["Нужно", "Могу", "Ищу</", "К обмену", "Core menu", "Перейти к автору", "опубликован", "войдите",
      "Этот сигнал", "Активн", "hidden-owner-id", "private", "members"]) expect(output).not.toContain(hidden);
    expect(output).not.toContain('action="/api/signals/card"');
    expect(output).not.toContain('href="/profile/');
    expect(mocks.signal).not.toHaveBeenCalled();
  });

  it("sends a guest like click to standard Telegram auth and back to the canonical card, never to a reaction API", async () => {
    mocks.participant.mockResolvedValue(null);
    mocks.guest.mockResolvedValue(guestSignal);
    const output = await html();
    expect(output).toContain(`href="/api/auth/telegram/start?next=%2Fexchange%2F${id}"`);
    expect(output).not.toContain("<form");
    expect(output).not.toContain("react_add");
    expect(mocks.reaction).not.toHaveBeenCalled();
  });

  it.each(["members", "private", "circle", "match_only", "network_blind", "archived", "closed"])(
    "denies a guest %s card", async () => {
      mocks.participant.mockResolvedValue(null);
      mocks.guest.mockResolvedValue(null);
      await expect(html()).rejects.toThrow("notFound");
      expect(mocks.types).not.toHaveBeenCalled();
    },
  );

  it("never reads member state or reactions for a guest public card", async () => {
    mocks.participant.mockResolvedValue(null);
    mocks.guest.mockResolvedValue(guestSignal);
    await html();
    expect(mocks.reaction).not.toHaveBeenCalled();
    expect(mocks.publicLikes).toHaveBeenCalledWith(id);
    expect(mocks.signal).not.toHaveBeenCalled();
  });

  it("keeps member permission denial as not found", async () => {
    mocks.signal.mockResolvedValue(null);
    await expect(html()).rejects.toThrow("notFound");
    expect(mocks.reaction).not.toHaveBeenCalled();
  });

  it("renders a long legacy label verbatim with its own restrained heading class", async () => {
    const original = "  " + "я".repeat(900) + "\n  ";
    mocks.signal.mockResolvedValue({ ...signal, mine: true, label: original, description: null, legacyBody: true });
    const output = await html();
    expect(output).toContain(original);
    expect(output).toContain('class="signalCardLabel"');
    expect(output).toContain("Уточнить формулировку");
  });

  it("publishes OpenGraph only for guest-readable public data and keeps noindex", async () => {
    const hidden = await generateMetadata(props);
    expect(hidden).toEqual({ title: "Сигнал", robots: { index: false, follow: false } });
    expect(JSON.stringify(hidden)).not.toContain("Надежда К");
    mocks.guest.mockResolvedValue(guestSignal);
    const shared = await generateMetadata(props);
    expect(shared.robots).toEqual({ index: false, follow: false });
    expect(shared.openGraph).toMatchObject({
      title: "Ищу работу в СПб", url: `http://localhost:3000/exchange/${id}`,
    });
    expect(JSON.stringify(shared)).not.toContain("Надежда К");
    expect(JSON.stringify(shared)).not.toContain("hidden-owner-id");
    expect(JSON.stringify(shared)).not.toContain("опубликован");
    expect(JSON.stringify(shared)).not.toContain("Нужен уважительный");
  });
});
