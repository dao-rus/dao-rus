import { describe, expect, it, vi } from "vitest";
import { cityKey, getGuardianAudienceWithDatabase } from "./guardian-audience";

const moscow = { name: "Москва", type: "город", country: "Россия" };
const kazan = { name: "Казань", type: "город", country: "Россия" };

function person(id: string, options: Record<string, unknown> = {}) {
  return {
    id, display_name: id, membership_status: "none", forum_joined: true,
    logged_in: false, is_bot: false, telegram_username: null,
    has_telegram_user_id: true, residence_name: null,
    residence_type: null, residence_country: null, interests: [],
    has_any_interests: Array.isArray(options.interests) && options.interests.length > 0,
    ...options,
  };
}

function withCity(city: typeof moscow) {
  return { residence_name: city.name, residence_type: city.type, residence_country: city.country };
}

const rows = [
  person("one", { ...withCity(moscow), interests: [{ key: "art", label: "Искусство" }] }),
  person("two", { ...withCity(moscow), interests: [{ key: "tech", label: "Технологии" }] }),
  person("three", { ...withCity(kazan), interests: [{ key: "art", label: "Искусство" }] }),
  person("four", { interests: [] }),
  person("five", { logged_in: true, forum_joined: false, ...withCity(kazan), interests: [] }),
  person("left", { membership_status: "left" }),
  person("excluded", { membership_status: "excluded" }),
  person("bot", { is_bot: true }),
  person("inactive", { forum_joined: false }),
];

function database() {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

describe("Guardian read-only audience", () => {
  it("counts current missing city and interests from current profile rows", async () => {
    const result = await getGuardianAudienceWithDatabase(database());
    expect(result.missingCity.map((entry) => entry.id)).toEqual(["four"]);
    expect(result.missingInterests.map((entry) => entry.id)).toEqual(["four", "five"]);
    expect(result.audience.map((entry) => entry.id)).toEqual(["one", "two", "three", "four", "five"]);
    expect(result.cities).toHaveLength(2);
    expect(result.interests.map((entry) => entry.key)).toEqual(["art", "tech"]);
  });

  it("filters by city", async () => {
    const result = await getGuardianAudienceWithDatabase(database(), { city: cityKey(moscow) });
    expect(result.audience.map((entry) => entry.id)).toEqual(["one", "two"]);
    expect(cityKey({ ...moscow, name: "МОСКВА" })).toBe(cityKey(moscow));
  });

  it("filters by one interest", async () => {
    const result = await getGuardianAudienceWithDatabase(database(), { interests: ["art"] });
    expect(result.audience.map((entry) => entry.id)).toEqual(["one", "three"]);
  });

  it("uses city AND interests", async () => {
    const result = await getGuardianAudienceWithDatabase(database(), { city: cityKey(moscow), interests: ["art"] });
    expect(result.audience.map((entry) => entry.id)).toEqual(["one"]);
  });

  it("uses OR for multiple interests", async () => {
    const result = await getGuardianAudienceWithDatabase(database(), { city: cityKey(moscow), interests: ["art", "tech"] });
    expect(result.audience.map((entry) => entry.id)).toEqual(["one", "two"]);
  });

  it("counts a private-only interest without exposing it as an admin filter or match", async () => {
    const privateOnly = person("private-only", { has_any_interests: true, interests: [] });
    const db = { query: vi.fn().mockResolvedValue({ rows: [privateOnly] }) };
    const result = await getGuardianAudienceWithDatabase(db);
    expect(result.missingInterests).toEqual([]);
    expect(result.interests).toEqual([]);
    expect((await getGuardianAudienceWithDatabase(db, { interests: ["private-topic"] })).audience).toEqual([]);
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql).toContain("interest.visibility IN ('public', 'members')");
    expect(sql).toContain("AS has_any_interests");
  });

  it("does not perform writes or read historical quest completion", async () => {
    const db = database();
    await getGuardianAudienceWithDatabase(db);
    expect(db.query).toHaveBeenCalledTimes(1);
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql.trimStart()).toMatch(/^WITH RECURSIVE\b/);
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|FOR UPDATE)\b/i);
    expect(sql).not.toContain("onboarding_quest_completions");
    expect(sql).toContain("participant_interests");
    expect(sql).toContain("participant_forum_onboarding");
    expect(sql).toContain("participant.logged_in");
    expect(sql).toContain("telegram_roster_entries");
  });

  it.each(["without_residence", "without_interests", "without_bio", "without_want", "without_need", "without_can", "without_have", "never_logged_in", "unverified"] as const)("resolves %s only among current participants", async condition => {
    const empty = person("empty");
    const complete = person("complete", { ...withCity(moscow), has_any_interests: true, has_bio: true, logged_in: true, is_verified: true,
      active_signal_kinds: ["want", "need", "can", "have"] });
    const db = { query: vi.fn().mockResolvedValue({ rows: [empty, complete, person("former", { membership_status: "left" }), person("bot", { is_bot: true }), person("inactive", { forum_joined: false })] }) };
    expect((await getGuardianAudienceWithDatabase(db, { conditions: [condition] })).audience.map(p => p.id)).toEqual(["empty"]);
  });
  it("ANDs predicates and city while ORing interests; private bio/signals count without exposing their text", async () => {
    const data = [person("match", { ...withCity(moscow), interests: [{ key: "art", label: "Искусство" }], has_bio: false, is_verified: false }),
      person("verified", { ...withCity(moscow), interests: [{ key: "tech", label: "Технологии" }], has_bio: false, is_verified: true }),
      person("private-bio", { ...withCity(moscow), interests: [{ key: "tech", label: "Технологии" }], has_bio: true }),
      person("other-city", { ...withCity(kazan), interests: [{ key: "art", label: "Искусство" }] })];
    const db = { query: vi.fn().mockResolvedValue({ rows: data }) };
    const result = await getGuardianAudienceWithDatabase(db, { city: cityKey(moscow), interests: ["art", "tech"], conditions: ["without_bio", "unverified"] });
    expect(result.audience.map(p => p.id)).toEqual(["match"]);
    const sql = db.query.mock.calls[0][0];
    expect(sql).toContain("status = 'active'"); expect(sql).toContain("verification_roots");
    expect(sql).toContain("attestation.revoked_at IS NULL"); expect(sql).not.toContain("profile_bio_visibility");
    expect(sql).not.toContain("body");
  });
});
