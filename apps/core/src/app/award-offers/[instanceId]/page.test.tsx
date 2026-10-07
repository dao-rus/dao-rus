import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { interfaceTextFields } from "../../../lib/interface-texts";
const mocks = vi.hoisted(() => ({ current: vi.fn(), offers: vi.fn() }));
vi.mock("@/lib/session", () => ({ getCurrentParticipant: mocks.current }));
vi.mock("@/lib/award-views", () => ({ getOwnAwardOffers: mocks.offers }));
vi.mock("@/lib/interface-texts", async () => { const m = await import("../../../lib/interface-texts"); return { readInterfaceTexts: async () => ({ values: Object.fromEntries(m.interfaceTextFields.map(f => [f.key, f.defaultValue])) }) }; });
vi.mock("@/lib/awards", async () => import("../../../lib/awards"));
vi.mock("@/components/award-content", async () => import("../../../components/award-content"));
vi.mock("@/components/user-text", async () => import("../../../components/user-text"));
vi.mock("@/components/local-date-time", () => ({ LocalDateTime: ({ value }: {
        value: string;
    }) => <time>{value}</time> }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
import Page from "./page";
const id = "10000000-0000-4000-8000-000000000001", date = new Date("2026-10-07T12:00:00Z");
const award = { id, slug: "test", name: "Test award", imageUrl: "/test.png", establishedOn: "2026-10-07", description: "Public", criterion: "Public", publicAddress: "Public", kind: "historical" as const, historicalCutoffAt: null, founderParticipantId: id, charterVersion: 1, createdAt: date };
const instance = { id, awardId: id, participantId: id, awardedByParticipantId: id, reason: "PRIVATE_REASON", personalAddress: "PRIVATE_MEMORY", status: "offered" as const, offeredAt: date, declinedAt: null, acceptedAt: null, rejectedAt: null, showInPublicList: false, showNextToName: false };
beforeEach(() => { vi.clearAllMocks(); });
describe("personal offer page", () => {
    const props = { params: Promise.resolve({ instanceId: id }), searchParams: Promise.resolve({}) };
    it("guest login preserves a safe destination without reading private content", async () => {
        mocks.current.mockResolvedValue(null);
        const html = renderToStaticMarkup(await Page(props));
        expect(html).toContain(encodeURIComponent(`/award-offers/${id}`));
        expect(html).not.toContain("PRIVATE");
        expect(mocks.offers).not.toHaveBeenCalled();
    });
    it("wrong recipient gets no private HTML", async () => {
        mocks.current.mockResolvedValue({ id });
        mocks.offers.mockResolvedValue([]);
        await expect(Page(props)).rejects.toThrow("NOT_FOUND");
        expect(mocks.offers).toHaveBeenCalledWith(id, id);
    });
    it.each(["offered", "declined", "accepted", "rejected"] as const)("shows only permitted actions in %s", async (status) => {
        mocks.current.mockResolvedValue({ id });
        mocks.offers.mockResolvedValue([{ award, instance: { ...instance, status }, awarderName: "Founder" }]);
        const html = renderToStaticMarkup(await Page(props));
        expect(html).toContain("PRIVATE_MEMORY");
        expect(html.includes('value="accept"')).toBe(status === "offered" || status === "declined");
        expect(html.includes('value="decline"')).toBe(status === "offered");
        expect(html.includes('value="reject"')).toBe(status === "accepted");
        expect(html.includes('name="showInPublicList"')).toBe(status === "accepted");
        if (status === "accepted")
            expect(html).toMatch(/<input[^>]*required=""[^>]*name="confirm"/);
    });
});
