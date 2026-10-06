import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NetworkSignal } from "../../../lib/signals";
const mocks = vi.hoisted(() => ({ participant: vi.fn(), signal: vi.fn(), types: vi.fn(), texts: vi.fn() }));
vi.mock("../../../lib/session", () => ({ getCurrentParticipant: mocks.participant }));
vi.mock("../../../lib/signals", () => ({ getSignal: mocks.signal, listSignalTypes: mocks.types }));
vi.mock("../../../lib/interface-texts", async (original) => ({ ...await original<typeof import("../../../lib/interface-texts")>(), readInterfaceTexts: mocks.texts }));
vi.mock("../../../components/core-navigation", () => ({ CoreNavigation: () => null }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); }, notFound: () => { throw new Error("notFound"); } }));
import Page, { generateMetadata } from "./page";
import { interfaceTextFields } from "../../../lib/interface-texts";
const id = "10000000-0000-4000-8000-000000000001";
const signal: NetworkSignal = { id, ownerId: "hidden-owner-id", typeKey: "future_type",
  label: "Canonical label", description: "Canonical description", visibility: "public", status: "active",
  legacyBody: false, createdAt: new Date(), updatedAt: new Date(), mine: false,
  author: { id: "hidden-owner-id", name: "Owner name" } };
async function html() { return renderToStaticMarkup(await Page({ params: Promise.resolve({ signalId: id }) })); }
beforeEach(() => {
  vi.clearAllMocks(); mocks.participant.mockResolvedValue({ id: "viewer" });
  mocks.signal.mockResolvedValue(signal);
  mocks.types.mockResolvedValue([{ key: "future_type", displayName: "Будущий тип", enabled: true }, { key: "need", displayName: "Нужно", enabled: true }]);
  mocks.texts.mockResolvedValue({ values: Object.fromEntries(interfaceTextFields.map((field) => [field.key, field.defaultValue])) });
});
describe("canonical Signal card", () => {
  it.each(["public", "members"])("renders a permitted %s card using canonical content and catalogue metadata", async (visibility) => {
    mocks.signal.mockResolvedValue({ ...signal, visibility, body: "Legacy projection must be ignored" });
    const output = await html();
    expect(mocks.signal).toHaveBeenCalledWith("viewer", id);
    expect(output).toContain("Будущий тип");
    expect(output).toContain("Canonical label");
    expect(output).toContain("Canonical description");
    expect(output).toContain('href="/profile/hidden-owner-id"');
    expect(output).not.toContain("Legacy projection must be ignored");
    expect(output).not.toContain('action="/api/profile/about"');
    expect(output).not.toContain("Кому видно");
  });
  it("shows owner actions and private visibility without widening domain access", async () => {
    mocks.signal.mockResolvedValue({ ...signal, mine: true, visibility: "private" });
    const output = await html();
    expect(output).toContain("Только мне"); expect(output).toContain("Активный");
    expect(output).toContain(`/exchange/new?signal=${id}`);
    expect(output).toContain('value="archive_signal"');
  });
  it.each(["unknown", "private foreign", "circle foreign", "match_only foreign", "archived foreign", "closed foreign"])("uses the same not-found for %s", async () => {
    mocks.signal.mockResolvedValue(null);
    await expect(html()).rejects.toThrow("notFound");
    expect(mocks.types).not.toHaveBeenCalled();
    expect(mocks.texts).not.toHaveBeenCalled();
  });
  it("requires the current Core login for public as well as other cards", async () => {
    mocks.participant.mockResolvedValue(null);
    await expect(html()).rejects.toThrow("redirect");
    expect(mocks.signal).not.toHaveBeenCalled();
  });
  it.each([false, true])("never renders blind identity or profile links (own=%s)", async (mine) => {
    // Even malformed adapter data cannot put identity in the rendered card.
    mocks.signal.mockResolvedValue({ ...signal, typeKey: "need", visibility: "network_blind", mine });
    const output = await html();
    expect(output).toContain("Canonical label");
    expect(output).not.toContain("hidden-owner-id"); expect(output).not.toContain("Owner name");
    expect(output).not.toContain('href="/profile/');
    expect(output.includes('action="/api/relay"')).toBe(!mine);
    if (!mine) expect(output).toContain(`name="signal_id" value="${id}"`);
  });
  it.each(["archived", "closed"])("shows own %s record without edit/archive/response actions", async (status) => {
    mocks.signal.mockResolvedValue({ ...signal, mine: true, status });
    const output = await html();
    expect(output).toContain(status === "archived" ? "В архиве" : "Закрыт");
    expect(output).not.toContain("/exchange/new"); expect(output).not.toContain("form");
  });
  it("renders a long legacy label verbatim and offers voluntary refinement only to the owner", async () => {
    const original = "  " + "я".repeat(900) + "\n  ";
    mocks.signal.mockResolvedValue({ ...signal, mine: true, label: original, description: null, legacyBody: true });
    const output = await html();
    expect(output).toContain(original); expect(output).toContain("Уточнить формулировку");
  });
  it("uses identical non-indexable metadata without consulting signal content or identity", async () => {
    const metadata = await generateMetadata();
    expect(metadata).toEqual({ title: "Сигнал", robots: { index: false, follow: false } });
    expect(mocks.signal).not.toHaveBeenCalled();
    expect(JSON.stringify(metadata)).not.toContain("Canonical");
    expect(JSON.stringify(metadata)).not.toContain("Owner");
    expect(metadata).not.toHaveProperty("description");
    expect(metadata).not.toHaveProperty("openGraph");
  });
});
