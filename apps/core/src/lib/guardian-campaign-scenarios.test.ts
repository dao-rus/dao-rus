import { describe, expect, it, vi } from "vitest";
import { cityKey, getGuardianAudienceWithDatabase } from "./guardian-audience";
import { guardianResidenceOptions, guardianScenario, guardianScenarios, guardianScenarioTypes, resolveGuardianScenarioAudience } from "./guardian-campaign-scenarios";

const city = { name: "Москва", type: "город", country: "Россия" };
const village = { name: "Москва", type: "село", country: "Россия" };
function person(id: string, options: Record<string, unknown> = {}) {
  return { id, display_name: id, membership_status: "active", residence_name: null,
    residence_type: null, residence_country: null, telegram_username: null,
    has_telegram_user_id: false, forum_joined: true, logged_in: false, is_bot: false,
    has_any_interests: false, interests: [], ...options };
}
function withResidence(residence: typeof city) {
  return { residence_name: residence.name, residence_type: residence.type, residence_country: residence.country };
}

async function overview() {
  const rows = [
    person("missing"),
    person("city-no-interests", withResidence(city)),
    person("city-private-interest", { ...withResidence(city), has_any_interests: true }),
    person("village", { ...withResidence(village), has_any_interests: true, logged_in: true, forum_joined: false }),
    person("left", { membership_status: "left", ...withResidence(city) }),
    person("excluded", { membership_status: "excluded", ...withResidence(city) }),
    person("bot", { is_bot: true, ...withResidence(city) }),
    person("not-current", { forum_joined: false, logged_in: false, ...withResidence(city) }),
  ];
  return getGuardianAudienceWithDatabase({ query: vi.fn(async () => ({ rows })) });
}

describe("Guardian smart/simple scenario catalog", () => {
  it("defines exactly four scenarios with system-owned actions and repeat rules", () => {
    expect(guardianScenarioTypes).toEqual([
      "profile_residence_prompt", "profile_interests_prompt", "town_meeting", "online_meeting",
    ]);
    expect(guardianScenarios.profile_residence_prompt).toMatchObject({ campaignKey: "profile_residence_prompt:v1",
      repeatPolicy: "once_per_version", actionLabel: "Указать город", actionUrl: "/profile#residence-name" });
    expect(guardianScenarios.profile_interests_prompt).toMatchObject({ campaignKey: "profile_interests_prompt:v1",
      repeatPolicy: "once_per_version", actionLabel: "Добавить интересы", actionUrl: "/profile#profile-interests" });
    for (const type of ["town_meeting", "online_meeting"] as const) {
      expect(guardianScenarios[type]).toMatchObject({ repeatPolicy: "repeatable", actionLabel: null, actionUrl: null });
    }
    expect(() => guardianScenario("toString")).toThrow();
  });

  it("resolves missing residence, missing interests at any visibility, and all current participants", async () => {
    const data = await overview();
    expect(resolveGuardianScenarioAudience("profile_residence_prompt", data).map(({ id }) => id)).toEqual(["missing"]);
    expect(resolveGuardianScenarioAudience("profile_interests_prompt", data).map(({ id }) => id))
      .toEqual(["missing", "city-no-interests"]);
    expect(resolveGuardianScenarioAudience("online_meeting", data).map(({ id }) => id))
      .toEqual(["missing", "city-no-interests", "city-private-interest", "village"]);
  });

  it("shows Core residence options with counts and selects the exact residence", async () => {
    const data = await overview();
    const options = guardianResidenceOptions(data);
    expect(options.map(({ count }) => count).sort()).toEqual([1, 2]);
    expect(options.map(({ label }) => label)).toContain("Москва, Россия (город)");
    expect(options.map(({ label }) => label)).toContain("Москва, Россия (село)");
    expect(resolveGuardianScenarioAudience("town_meeting", data, { residenceKey: cityKey(city) }).map(({ id }) => id))
      .toEqual(["city-no-interests", "city-private-interest"]);
    expect(() => resolveGuardianScenarioAudience("town_meeting", data, { residenceKey: "unknown" })).toThrow();
  });
});
