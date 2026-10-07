import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AwardAccessError, hasAwardCapability, requireAwardCapability } from "./award-access";
import { founderParticipantId } from "./config";

afterEach(() => vi.unstubAllEnvs());
describe("initial award authority", () => {
  it("fails closed without an explicit valid founder, even for a technical admin", () => {
    const admin = randomUUID();
    vi.stubEnv("ADMIN_PARTICIPANT_IDS", admin);
    for (const value of ["", "not-a-uuid", `${admin},${randomUUID()}`]) {
      vi.stubEnv("FOUNDER_PARTICIPANT_ID", value);
      expect(founderParticipantId()).toBeNull();
      expect(hasAwardCapability(admin, "award.establish")).toBe(false);
      expect(() => requireAwardCapability(admin, "award.offer")).toThrow(AwardAccessError);
    }
  });
  it("allows both capabilities only for the configured Participant, independently of admin rights", () => {
    const founder = randomUUID(), other = randomUUID();
    vi.stubEnv("FOUNDER_PARTICIPANT_ID", ` ${founder.toUpperCase()} `);
    vi.stubEnv("ADMIN_PARTICIPANT_IDS", other);
    for (const capability of ["award.establish", "award.offer"] as const) {
      expect(hasAwardCapability(founder, capability)).toBe(true);
      expect(hasAwardCapability(other, capability)).toBe(false);
    }
    expect(hasAwardCapability(founder, "future.authority" as never)).toBe(false);
  });
});
