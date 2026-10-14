import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const mocks = vi.hoisted(() => ({ publicAward: vi.fn(), offers: vi.fn(), current: vi.fn() }));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.current }));
vi.mock("@/lib/award-views", () => ({ getPublicAward: mocks.publicAward, getOwnAwardOffers: mocks.offers }));
vi.mock("@/lib/interface-texts", async () => { const m = await import("../../../lib/interface-texts"); return { readInterfaceTexts: async () => ({ values: Object.fromEntries(m.interfaceTextFields.map(f => [f.key, f.defaultValue])) }) }; });
vi.mock("@/components/award-content", async () => import("../../../components/award-content"));
vi.mock("@/components/user-text", async () => import("../../../components/user-text"));
vi.mock("@/components/local-date-time", () => ({ LocalDateTime: ({ value }: { value: string }) => <time>{value}</time> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), notFound: () => { throw new Error("NOT_FOUND"); } }));
import Page from "./page";
const id = "10000000-0000-4000-8000-000000000001", other = "20000000-0000-4000-8000-000000000002", date = new Date("2026-10-07T12:00:00Z");
const award = { id, name: "First wave", slug: "wave", imageUrl: "/test.png", establishedOn: "2026-10-07", description: "Public description", criterion: "Public criterion", publicAddress: "Public greeting", kind: "historical" as const, historicalCutoffAt: null, founderParticipantId: id, charterVersion: 1, createdAt: date };
const instance = { id, awardId: id, participantId: id, awardedByParticipantId: id, reason: "PRIVATE_REASON", personalAddress: "PRIVATE_ADDRESS", status: "offered" as const, offeredAt: date, declinedAt: null, acceptedAt: null, rejectedAt: null, showInPublicList: false, showNextToName: false };
const props = { params: Promise.resolve({ slug: "wave" }) };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.publicAward.mockResolvedValue({ award, recipients: [{ id: "person", name: "Public recipient" }] });
  mocks.current.mockResolvedValue(null);
});
describe("shared award page", () => {
  it("keeps the shared page to the award itself: no founder working notes, names link to profiles, establishment date in the footer", async () => {
    const html = renderToStaticMarkup(await Page(props));
    expect(html).toContain("First wave");
    expect(html).toContain("Public greeting");
    expect(html).toContain('href="/profile/person"');
    expect(html).toContain("awardFooter");
    expect(html).toContain("awardMedal");
    expect(html).toContain("<dialog");
    expect(html).toContain("awardRoll");
    expect(html).toMatch(/awardFooter[\s\S]*2026-10-07/);
    expect(html).not.toContain("Public description");
    expect(html).not.toContain("Public criterion");
    expect(html).not.toContain("Критерий");
  });
  it("shows an anonymous visitor only public information, the opted-in names and a safe login that returns here", async () => {
    const html = renderToStaticMarkup(await Page(props));
    expect(html).toContain("ДАО Русь"); expect(html).toContain("Public greeting"); expect(html).toContain("Public recipient");
    expect(html).toContain(encodeURIComponent("/awards/wave"));
    expect(html).not.toContain("PRIVATE"); expect(html).not.toContain('value="accept"');
    expect(mocks.offers).not.toHaveBeenCalled();
  });
  it("shows a signed-in visitor who has no offer nothing beyond the public page and no login prompt", async () => {
    mocks.current.mockResolvedValue({ id: other });
    mocks.offers.mockResolvedValue([{ award: { ...award, id: other }, instance: { ...instance, participantId: other }, awarderName: "Founder" }]);
    const html = renderToStaticMarkup(await Page(props));
    expect(html).toContain("Public greeting");
    expect(html).not.toContain("PRIVATE"); expect(html).not.toContain('value="accept"'); expect(html).not.toContain("/api/auth/telegram/start");
    expect(mocks.offers).toHaveBeenCalledWith(other);
  });
  it.each(["offered", "declined", "accepted", "rejected"] as const)("gives the recipient the dialog for their own %s offer", async (status) => {
    mocks.current.mockResolvedValue({ id });
    mocks.offers.mockResolvedValue([{ award, instance: { ...instance, status }, awarderName: "Founder" }]);
    const html = renderToStaticMarkup(await Page(props));
    expect(html).toContain("PRIVATE_REASON"); expect(html).toContain("PRIVATE_ADDRESS");
    expect(html.includes('value="accept"')).toBe(status === "offered" || status === "declined");
    expect(html.includes('value="decline"')).toBe(status === "offered");
    expect(html.includes('value="reject"')).toBe(status === "accepted");
    expect(html).not.toContain("/api/auth/telegram/start");
  });
  it("answers an unknown award with not found for everyone", async () => {
    mocks.publicAward.mockResolvedValue(null);
    await expect(Page(props)).rejects.toThrow("NOT_FOUND");
    expect(mocks.offers).not.toHaveBeenCalled();
  });
});
