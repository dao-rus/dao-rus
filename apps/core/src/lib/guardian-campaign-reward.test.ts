import { describe, expect, it, vi } from "vitest";
import { getGuardianCampaignRewardWithDatabase } from "./guardian-campaign-reward";

describe("Guardian system reward wording", () => {
  it.each([
    ["profile_residence_prompt", "residence_first_filled", "первое заполнение"],
    ["profile_interests_prompt", "interest_first_added", "первое добавление интереса"],
  ] as const)("reads current rule amount for %s", async (type, action, wording) => {
    const query = vi.fn().mockResolvedValue({ rows: [{ amount: "1.250000", active: true }], rowCount: 1 });
    const reward = await getGuardianCampaignRewardWithDatabase({ query }, type);
    expect(reward?.note).toBe(`Награда: +1,25 DARUS за ${wording}`);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("ORDER BY version DESC LIMIT 1"), [action]);
    expect(query.mock.calls[0][0]).toContain("effective_from <= clock_timestamp()");
    expect(query.mock.calls[0][0]).toContain("effective_to > clock_timestamp()");
    // Select latest version first, including a disabling version, rather than fall back to an old active rule.
    expect(query.mock.calls[0][0]).not.toContain("active = true");
  });

  it.each([{ rows: [] }, { rows: [{ amount: "5", active: false }] }])("returns no promise when missing or inactive", async ({ rows }) => {
    const query = vi.fn().mockResolvedValue({ rows, rowCount: rows.length });
    expect(await getGuardianCampaignRewardWithDatabase({ query }, "profile_interests_prompt")).toBeNull();
  });

  it.each(["town_meeting", "online_meeting"] as const)("does not query rewards for %s", async (type) => {
    const query = vi.fn();
    expect(await getGuardianCampaignRewardWithDatabase({ query }, type)).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
