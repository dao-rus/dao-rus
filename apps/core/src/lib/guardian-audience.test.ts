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

  it("does not perform writes or read historical quest completion", async () => {
    const db = database();
    await getGuardianAudienceWithDatabase(db);
    expect(db.query).toHaveBeenCalledTimes(1);
    const sql = db.query.mock.calls[0][0] as string;
    expect(sql.trimStart()).toMatch(/^SELECT\b/);
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|FOR UPDATE)\b/i);
    expect(sql).not.toContain("onboarding_quest_completions");
    expect(sql).toContain("participant_interests");
    expect(sql).toContain("participant_forum_onboarding");
    expect(sql).toContain("participant.logged_in");
    expect(sql).toContain("telegram_roster_entries");
  });
});
