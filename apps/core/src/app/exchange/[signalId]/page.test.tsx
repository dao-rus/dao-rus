import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NetworkSignal } from "../../../lib/signals";

const mocks = vi.hoisted(() => ({ participant: vi.fn(), signal: vi.fn(), guest: vi.fn(),
  types: vi.fn(), texts: vi.fn(), reaction: vi.fn() }));
vi.mock("../../../lib/session", () => ({ getCurrentParticipant: mocks.participant }));
vi.mock("../../../lib/signals", () => ({ getSignal: mocks.signal,
  getGuestShareableSignal: mocks.guest, listSignalTypes: mocks.types }));
vi.mock("../../../lib/signal-reactions", () => ({ readSignalReactionState: mocks.reaction }));
vi.mock("../../../lib/interface-texts", async (original) => ({
  ...await original<typeof import("../../../lib/interface-texts")>(), readInterfaceTexts: mocks.texts,
}));
vi.mock("../../../components/core-navigation", () => ({ CoreNavigation: () => <nav>Core menu</nav> }));
vi.mock("../../../components/signal-share-action", () => ({ SignalShareAction: ({ payload, labels }: {
  payload: { title: string; text: string; url: string }; labels: { share: string };
}) => <button data-share-url={payload.url} data-share-title={payload.title}
  data-share-text={payload.text}>{labels.share}</button> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); } }));

import Page, { generateMetadata } from "./page";
import { interfaceTextFields } from "../../../lib/interface-texts";

const id = "10000000-0000-4000-8000-000000000001";
const signal: NetworkSignal = { id, ownerId: "hidden-owner-id", typeKey: "need",
  label: "Ищу работу в СПб", description: "Нужен уважительный коллектив.", visibility: "public", status: "active",
  legacyBody: false, externalShareEnabled: false, createdAt: new Date(), updatedAt: new Date(), mine: false,
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
    expect(output).toContain("Полезно · 2");
    expect(output).not.toContain("Поддержать сеть");
    expect(output).not.toContain("Перевод токенов на поддержку сети пока недоступен.");
    expect(output).not.toContain('data-share-url=');
  });

  it("shows owner edit/archive and explicit external-share consent, without self reaction", async () => {
    mocks.signal.mockResolvedValue({ ...signal, mine: true });
    const output = await html();
    expect(output).toContain(`/exchange/new?signal=${id}`);
    expect(output).toContain('value="archive_signal"');
    expect(output).toContain('name="confirm_external_share"');
    expect(output).toContain("включая моё имя");
    expect(output).not.toContain("Полезно ·");
    expect(output).not.toContain('action="/api/relay"');
  });

  it("shares only an opted-in active public card with a neutral payload", async () => {
    mocks.signal.mockResolvedValue({ ...signal, externalShareEnabled: true });
    const output = await html();
    expect(output).toContain(`data-share-url="http://localhost:3000/exchange/${id}"`);
    expect(output).toContain('data-share-text="Сигнал в сети ДАО Русь."');
    expect(output).not.toContain("hidden-owner-id</button>");
  });

  it("never renders blind identity, even if a malformed adapter supplies it", async () => {
    mocks.signal.mockResolvedValue({ ...signal, visibility: "network_blind", typeKey: "need",
      externalShareEnabled: true, author: { id: "hidden-owner-id", name: "Надежда К" } });
    const output = await html();
    expect(output).toContain('action="/api/relay"');
    expect(output).toContain("Откликнуться");
    expect(output).toContain("Полезно · 2");
    expect(output).not.toContain("hidden-owner-id");
    expect(output).not.toContain("Надежда К");
    expect(output).not.toContain('data-share-url=');
  });

  it("renders a self-contained guest card only for explicit share policy", async () => {
    mocks.participant.mockResolvedValue(null);
    mocks.guest.mockResolvedValue(guestSignal);
    const output = await html();
    expect(output).toContain('class="signalGuestHeader"');
    expect(output).toContain('href="/">ДАО Русь</a>');
    expect(output).toContain("Этот сигнал опубликован в сети ДАО Русь.");
    expect(output).toContain("Ищу работу в СПб");
    expect(output).toContain("Надежда К");
    expect(output).toContain("Поделиться");
    expect(output).not.toContain("Core menu");
    expect(output).not.toContain('action="/api/signals/card"');
    expect(output).not.toContain('href="/profile/');
    expect(output).not.toContain("hidden-owner-id");
    expect(mocks.signal).not.toHaveBeenCalled();
  });

  it.each(["unshared public", "members", "private", "circle", "match_only", "network_blind", "archived", "closed"])(
    "denies a guest %s card", async () => {
      mocks.participant.mockResolvedValue(null);
      mocks.guest.mockResolvedValue(null);
      await expect(html()).rejects.toThrow("notFound");
      expect(mocks.types).not.toHaveBeenCalled();
    },
  );

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

  it("publishes OpenGraph only for guest-shareable data and keeps noindex", async () => {
    const hidden = await generateMetadata(props);
    expect(hidden).toEqual({ title: "Сигнал", robots: { index: false, follow: false } });
    expect(JSON.stringify(hidden)).not.toContain("Надежда К");
    mocks.guest.mockResolvedValue(guestSignal);
    const shared = await generateMetadata(props);
    expect(shared.robots).toEqual({ index: false, follow: false });
    expect(shared.openGraph).toMatchObject({
      title: "? Нужно: Ищу работу в СПб", description: "Этот сигнал опубликован в сети ДАО Русь.",
      url: `http://localhost:3000/exchange/${id}`,
    });
    expect(JSON.stringify(shared)).not.toContain("Надежда К");
    expect(JSON.stringify(shared)).not.toContain("hidden-owner-id");
  });
});
