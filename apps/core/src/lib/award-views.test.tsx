import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getAwardBadgesWithDatabase, getPublicAwardWithDatabase, getOwnAwardOffersWithDatabase } from "./award-views";
import { ParticipantName } from "../components/participant-name";
import { prepareAwardImages } from "./award-images";
import sharp from "sharp";
const id = "10000000-0000-4000-8000-000000000001";
describe("award privacy and badge projections", () => {
    it("loads all participant badges once and filters accepted independent nickname opt-ins", async () => {
        const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ participant_id: id, id, name: "Award", slug: "test" }] });
        const badges = await getAwardBadgesWithDatabase({ query }, [id, id]);
        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls[0][1]).toEqual([[id]]);
        expect(query.mock.calls[0][0]).toContain("i.status='accepted' AND i.show_next_to_name");
        const html = renderToStaticMarkup(<ParticipantName participantId={id} verificationPoints={1} positiveCount={2} awardBadges={badges[id]}>Person</ParticipantName>);
        expect(html).toContain('href="/awards/test"');
        expect(html).toContain(`/api/award-images/${id}/badge`);
        expect(html).toContain('width="18"');
        expect(html).toContain("verificationIndex");
        expect(html).toContain("reputationIndex");
        expect(renderToStaticMarkup(<ParticipantName participantId={id} verificationPoints={0} positiveCount={0}>Person</ParticipantName>)).not.toContain("awardBadge");
    });
    it("public recipients select no private columns; own offers require recipient even for known UUID", async () => {
        const query = vi.fn().mockResolvedValueOnce({ rowCount: 1, rows: [{ id, slug: "test" }] }).mockResolvedValueOnce({ rowCount: 1, rows: [{ id, display_name: "Public person", reason: "PRIVATE", personal_address: "SECRET" }] }).mockResolvedValueOnce({ rowCount: 0, rows: [] });
        const publicAward = await getPublicAwardWithDatabase({ query }, "test");
        expect(publicAward!.recipients).toEqual([{ id, name: "Public person" }]);
        expect(query.mock.calls[1][0]).toContain("SELECT p.id,p.display_name");
        expect(query.mock.calls[1][0]).toContain("i.status='accepted' AND i.show_in_public_list");
        expect(query.mock.calls[1][0]).not.toContain("reason");
        expect(await getOwnAwardOffersWithDatabase({ query }, id, id)).toEqual([]);
        expect(query.mock.calls[2][0]).toContain("WHERE i.participant_id=$1");
        expect(query.mock.calls[2][1]).toEqual([id, id]);
    });
    it("generates a separate 48px preview and strips original metadata", async () => {
        const input = await sharp({ create: { width: 120, height: 90, channels: 4, background: "red" } }).png().toBuffer();
        const result = await prepareAwardImages(new File([new Uint8Array(input)], "test.png"));
        expect((await sharp(result.thumbnail).metadata()).width).toBe(48);
        expect((await sharp(result.thumbnail).metadata()).height).toBe(48);
        expect(result.thumbnail.equals(result.original)).toBe(false);
        await expect(prepareAwardImages(new File(["<svg/>"], "x.svg"))).rejects.toThrow("PNG");
    });
});
