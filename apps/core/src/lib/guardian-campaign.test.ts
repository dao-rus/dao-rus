import { beforeEach, describe, expect, it, vi } from "vitest";
import { cityKey } from "./guardian-audience";

const audience = vi.hoisted(() => ({ getGuardianAudienceWithDatabase: vi.fn() }));
vi.mock("./guardian-audience", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./guardian-audience")>()),
  getGuardianAudienceWithDatabase: audience.getGuardianAudienceWithDatabase,
}));

import { launchGuardianCampaignWithDatabase } from "./guardian-campaign";

const city = { name: "Москва", type: "город", country: "Россия" };
const person = (id: string, residence: typeof city | null = null) => ({ id, residence });
function overview(people = [person("one", city), person("two")]) {
  return { missingCity: people.filter((p) => !p.residence), missingInterests: people,
    audience: people, cities: [{ key: cityKey(city), residence: city }], interests: [] };
}

function database(identities: Record<string, string> = {}) {
  const state: { campaigns: Array<Record<string, unknown>>; notifications: string[]; deliveries: string[] } = {
    campaigns: [], notifications: [], deliveries: [],
  };
  const sql: string[] = [];
  const notificationInputs: unknown[][] = [];
  let lock = Promise.resolve();
  const connect = vi.fn(async () => {
    let unlock = () => {};
    let before: typeof state | null = null;
    const query = vi.fn(async (statement: string, values: unknown[] = []) => {
      sql.push(statement);
      if (statement === "BEGIN") {
        before = { campaigns: [...state.campaigns], notifications: [...state.notifications], deliveries: [...state.deliveries] };
        return { rowCount: null, rows: [] };
      }
      if (statement.includes("pg_advisory_xact_lock")) {
        const previous = lock;
        lock = new Promise<void>((resolve) => { unlock = resolve; });
        await previous;
        return { rowCount: 1, rows: [] };
      }
      if (statement === "COMMIT") { unlock(); return { rowCount: null, rows: [] }; }
      if (statement === "ROLLBACK") {
        if (before) {
          state.campaigns = before.campaigns;
          state.notifications = before.notifications;
          state.deliveries = before.deliveries;
        }
        unlock();
        return { rowCount: null, rows: [] };
      }
      if (statement.includes("FROM guardian_campaigns WHERE campaign_key = $1")) {
        const row = state.campaigns.find((campaign) => campaign.campaign_key === values[0]);
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }
      if (statement.includes("FROM external_identities identity")) {
        const ids = values[0] as string[];
        const rows = ids.flatMap((id) => identities[id] ? [{ participant_id: id, external_user_id: identities[id], identity_conflict: false }] : []);
        return { rowCount: rows.length, rows };
      }
      if (statement.includes("INSERT INTO guardian_campaigns")) {
        const row = { id: `00000000-0000-4000-8000-${String(state.campaigns.length + 1).padStart(12, "0")}`,
          campaign_key: values[0], campaign_type: values[1], text: values[2],
          action_label: values[3], action_url: values[4], audience_rule: JSON.parse(values[5] as string),
          created_at: "2026-10-04T00:00:00Z", recipient_count: values[7], telegram_delivery_count: values[8],
          created_by_participant_id: values[6] };
        state.campaigns.push(row);
        return { rowCount: 1, rows: [row] };
      }
      if (statement.includes("INSERT INTO notifications")) {
        notificationInputs.push(values);
        state.notifications.push(...values[1] as string[]);
        return { rowCount: (values[1] as string[]).length, rows: [] };
      }
      if (statement.includes("INSERT INTO notification_deliveries")) {
        state.deliveries.push(...values[1] as string[]);
        return { rowCount: (values[1] as string[]).length, rows: [] };
      }
      throw new Error(`Unexpected SQL: ${statement}`);
    });
    return { query, release: vi.fn() };
  });
  return { state, sql, notificationInputs, connect };
}

describe("Guardian campaign transaction", () => {
  beforeEach(() => { vi.clearAllMocks(); audience.getGuardianAudienceWithDatabase.mockResolvedValue(overview()); });

  it("re-resolves audience, keeps edited text and fixed CTA, and queues only eligible identities", async () => {
    const db = database({ one: "123456" });
    // Preview used an earlier count; participant two has since added an interest.
    audience.getGuardianAudienceWithDatabase.mockResolvedValueOnce({ ...overview(), missingInterests: [person("one", city)] });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const result = await launchGuardianCampaignWithDatabase(db, "admin", {
        scenario: "profile_interests_prompt", text: "Отредактированный текст",
      });
      expect(result.campaign).toMatchObject({ campaignKey: "profile_interests_prompt:v1", recipientCount: 1,
        telegramDeliveryCount: 1, text: "Отредактированный текст", actionLabel: "Добавить интересы",
        actionUrl: "/profile#profile-interests" });
      expect(db.notificationInputs[0]).toEqual([result.campaign.id, ["one"], "guardian.profile_interests_prompt",
        "Отредактированный текст", "Добавить интересы", "/profile#profile-interests", "admin"]);
      expect(db.state.notifications).toEqual(["one"]);
      expect(db.state.deliveries).toEqual(["one"]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });

  it("creates Core Notification without a Telegram delivery when identity is absent", async () => {
    const db = database();
    audience.getGuardianAudienceWithDatabase.mockResolvedValue({ ...overview(), missingCity: [person("two")] });
    const result = await launchGuardianCampaignWithDatabase(db, "admin", { scenario: "profile_residence_prompt", text: "Город" });
    expect(result.campaign).toMatchObject({ campaignKey: "profile_residence_prompt:v1",
      actionLabel: "Указать город", actionUrl: "/profile#residence-name", recipientCount: 1, telegramDeliveryCount: 0 });
    expect(db.notificationInputs[0]?.slice(1, 6)).toEqual([["two"], "guardian.profile_residence_prompt", "Город",
      "Указать город", "/profile#residence-name"]);
    expect(db.state.deliveries).toEqual([]);
  });

  it("returns the same immutable one-shot campaign under concurrent launch", async () => {
    const db = database({ one: "123456" });
    const [a, b] = await Promise.all([
      launchGuardianCampaignWithDatabase(db, "admin", { scenario: "profile_interests_prompt", text: "Первый" }),
      launchGuardianCampaignWithDatabase(db, "admin", { scenario: "profile_interests_prompt", text: "Второй" }),
    ]);
    expect([a.launched, b.launched].sort()).toEqual([false, true]);
    expect(a.campaign.id).toBe(b.campaign.id);
    expect(db.state.campaigns).toHaveLength(1);
    expect(db.state.notifications).toEqual(["one", "two"]);
  });

  it("deduplicates repeated participant rows within one campaign", async () => {
    const db = database();
    audience.getGuardianAudienceWithDatabase.mockResolvedValue({ ...overview(), audience: [person("one", city), person("one", city)] });
    const result = await launchGuardianCampaignWithDatabase(db, "admin", { scenario: "online_meeting", text: "Встреча" });
    expect(result.campaign.recipientCount).toBe(1);
    expect(db.state.notifications).toEqual(["one"]);
  });

  it.each(["town_meeting", "online_meeting"] as const)("launches repeatable %s twice with distinct keys and no CTA", async (scenario) => {
    const db = database({ one: "123456" });
    const input = { scenario, text: "Текст встречи", ...(scenario === "town_meeting" ? { residenceKey: cityKey(city) } : {}) };
    const first = await launchGuardianCampaignWithDatabase(db, "admin", input);
    const second = await launchGuardianCampaignWithDatabase(db, "admin", input);
    expect(first.campaign.campaignKey).not.toBe(second.campaign.campaignKey);
    expect(db.state.campaigns).toHaveLength(2);
    expect(first.campaign).toMatchObject({ actionLabel: null, actionUrl: null });
    expect(db.notificationInputs[0]?.slice(2, 6)).toEqual([`guardian.${scenario}`, "Текст встречи", null, null]);
    expect(db.state.notifications).toHaveLength(scenario === "town_meeting" ? 2 : 4);
  });

  it("rolls back campaign, notifications and deliveries if fan-out fails", async () => {
    const db = database({ one: "123456" });
    const originalConnect = db.connect;
    db.connect = vi.fn(async () => {
      const client = await originalConnect();
      const originalQuery = client.query;
      client.query = vi.fn(async (statement, values) => {
        if (statement.includes("INSERT INTO notification_deliveries")) throw new Error("delivery insert failed");
        return originalQuery(statement, values);
      });
      return client;
    });
    await expect(launchGuardianCampaignWithDatabase(db, "admin", { scenario: "online_meeting", text: "Встреча" }))
      .rejects.toThrow("delivery insert failed");
    expect(db.sql.at(-1)).toBe("ROLLBACK");
    expect(db.state).toEqual({ campaigns: [], notifications: [], deliveries: [] });
  });
});
