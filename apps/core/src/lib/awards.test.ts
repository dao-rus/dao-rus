import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AwardAccessError, AwardValidationError, awardInstancePublicity, establishAwardWithDatabase,
  offerAwardWithDatabase, type AwardDatabase, type EstablishAwardInput,
} from "./awards";

const founder = randomUUID();
const definition: EstablishAwardInput = {
  slug: "first-wave", name: "Орден Первой волны", imageUrl: "/awards/first-wave.png",
  establishedOn: "2026-10-07", description: "Историческая награда", criterion: "Указание Учредителя",
  publicAddress: "Спасибо", kind: "historical", historicalCutoffAt: "2026-01-01T00:00:00+03:00",
};
afterEach(() => vi.unstubAllEnvs());
describe("award validation and visibility", () => {
  it("denies establishing/offering before connecting when actor lacks institutional authority", async () => {
    vi.stubEnv("FOUNDER_PARTICIPANT_ID", founder);
    const connect = vi.fn(), database = { connect } as unknown as AwardDatabase;
    await expect(establishAwardWithDatabase(database, randomUUID(), definition)).rejects.toBeInstanceOf(AwardAccessError);
    await expect(offerAwardWithDatabase(database, randomUUID(), {
      awardId: randomUUID(), participantId: randomUUID(), reason: "Contribution",
    })).rejects.toBeInstanceOf(AwardAccessError);
    expect(connect).not.toHaveBeenCalled();
  });
  it.each([
    ["slug", "../first-wave"], ["name", " "], ["imageUrl", "javascript:alert(1)"],
    ["imageUrl", "//example.test/image.png"], ["imageUrl", "https://user:pass@example.test/image.png"],
    ["establishedOn", "2026-02-30"], ["criterion", ""], ["publicAddress", ""], ["kind", "future"],
    ["historicalCutoffAt", "2026-01-01T00:00:00"], ["historicalCutoffAt", "2026-02-30T00:00:00Z"],
  ])("rejects invalid %s before connecting", async (field, value) => {
    vi.stubEnv("FOUNDER_PARTICIPANT_ID", founder);
    const connect = vi.fn();
    await expect(establishAwardWithDatabase({ connect } as unknown as AwardDatabase, founder, {
      ...definition, [field]: value,
    })).rejects.toBeInstanceOf(AwardValidationError);
    expect(connect).not.toHaveBeenCalled();
  });
  it("denies a historical cutoff on an open award", async () => {
    vi.stubEnv("FOUNDER_PARTICIPANT_ID", founder);
    await expect(establishAwardWithDatabase({} as AwardDatabase, founder, { ...definition, kind: "open" }))
      .rejects.toBeInstanceOf(AwardValidationError);
  });
  it.each(["offered", "declined", "rejected"] as const)("never exposes %s even with stored public flags", status => {
    expect(awardInstancePublicity({ status, showInPublicList: true, showNextToName: true }))
      .toEqual({ inPublicList: false, nextToName: false });
  });
  it("keeps the two publication choices independent while accepted", () => {
    expect(awardInstancePublicity({ status: "accepted", showInPublicList: true, showNextToName: false }))
      .toEqual({ inPublicList: true, nextToName: false });
    expect(awardInstancePublicity({ status: "accepted", showInPublicList: false, showNextToName: true }))
      .toEqual({ inPublicList: false, nextToName: true });
  });
});
