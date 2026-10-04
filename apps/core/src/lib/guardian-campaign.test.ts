import { beforeEach, describe, expect, it, vi } from "vitest";

const audience = vi.hoisted(() => ({ getGuardianAudienceWithDatabase: vi.fn() }));
vi.mock("./guardian-audience", () => ({ getGuardianAudienceWithDatabase: audience.getGuardianAudienceWithDatabase }));

import { launchProfileInterestsCampaignWithDatabase } from "./guardian-campaign";
import { parseGuardianCampaignDraft, PROFILE_INTERESTS_DEFAULTS } from "./guardian-campaign-input";

const recipient = (id: string) => ({ id });
const draft = { ...PROFILE_INTERESTS_DEFAULTS, text: "Отредактированный текст", actionLabel: "Моя кнопка" };

function database(identities: Record<string, string> = {}) {
  const state: { campaign: Record<string, unknown> | null; notifications: string[]; deliveries: string[] } = {
    campaign: null, notifications: [], deliveries: [],
  };
  const sql: string[] = [];
  let lock = Promise.resolve();
  const connect = vi.fn(async () => {
    let unlock = () => {};
    let before: typeof state | null = null;
    const query = vi.fn(async (statement: string, values: unknown[] = []) => {
      sql.push(statement);
      if (statement === "BEGIN") {
        before = { campaign: state.campaign, notifications: [...state.notifications], deliveries: [...state.deliveries] };
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
          state.campaign = before.campaign;
          state.notifications = before.notifications;
          state.deliveries = before.deliveries;
        }
        unlock();
        return { rowCount: null, rows: [] };
      }
      if (statement.includes("FROM guardian_campaigns WHERE campaign_key")) {
        return { rowCount: state.campaign ? 1 : 0, rows: state.campaign ? [state.campaign] : [] };
      }
      if (statement.includes("FROM external_identities identity")) {
        const ids = values[0] as string[];
        const rows = ids.flatMap((id) => identities[id] ? [{ participant_id: id, external_user_id: identities[id], identity_conflict: false }] : []);
        return { rowCount: rows.length, rows };
      }
      if (statement.includes("INSERT INTO guardian_campaigns")) {
        state.campaign = { id: "campaign-1", text: values[2], action_label: values[3], action_url: values[4],
          created_at: "2026-10-04T00:00:00Z", recipient_count: values[7], telegram_delivery_count: values[8],
          created_by_participant_id: values[6] };
        return { rowCount: 1, rows: [state.campaign] };
      }
      if (statement.includes("INSERT INTO notifications")) {
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
  return { state, sql, connect };
}

describe("first Guardian campaign", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("validates the editable text, action label and URL before any DB access", async () => {
    const db = database();
    expect(() => parseGuardianCampaignDraft({ ...draft, actionUrl: "javascript:alert(1)" })).toThrow();
    await expect(launchProfileInterestsCampaignWithDatabase(db, "admin", { ...draft, text: " " })).rejects.toThrow();
    expect(db.connect).not.toHaveBeenCalled();
  });

  it("recomputes the current audience, excludes a newly interested person and fans out atomically", async () => {
    const db = database({ one: "123456" });
    let people = [recipient("one"), recipient("two"), recipient("three")];
    audience.getGuardianAudienceWithDatabase.mockImplementation(async () => ({ missingInterests: people }));
    // Preview is read-only and leaves the database untouched.
    expect(people).toHaveLength(3);
    expect(db.connect).not.toHaveBeenCalled();
    people = [recipient("one"), recipient("three")]; // participant two added an interest
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const result = await launchProfileInterestsCampaignWithDatabase(db, "admin", draft);
      expect(result.launched).toBe(true);
      expect(result.campaign).toMatchObject({ text: draft.text, actionLabel: draft.actionLabel,
        actionUrl: draft.actionUrl, recipientCount: 2, telegramDeliveryCount: 1 });
      expect(stateOf(db)).toEqual({ notifications: ["one", "three"], deliveries: ["one"] });
      expect(db.sql).toContain("COMMIT");
      expect(db.sql.find((value) => value.includes("INSERT INTO notifications"))).toContain("'guardian.profile_interests_prompt'");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally { fetchSpy.mockRestore(); }
  });

  it("returns the immutable snapshot on repeated or concurrent launch", async () => {
    const db = database({ one: "123456" });
    audience.getGuardianAudienceWithDatabase.mockResolvedValue({ missingInterests: [recipient("one")] });
    const [a, b] = await Promise.all([
      launchProfileInterestsCampaignWithDatabase(db, "admin", draft),
      launchProfileInterestsCampaignWithDatabase(db, "admin", { ...draft, text: "Second attempt" }),
    ]);
    expect([a.launched, b.launched].sort()).toEqual([false, true]);
    expect(a.campaign.text).toBe(b.campaign.text);
    expect(db.state.notifications).toEqual(["one"]);
    expect(db.state.deliveries).toEqual(["one"]);
    expect(db.sql.filter((value) => value.includes("INSERT INTO guardian_campaigns"))).toHaveLength(1);
  });

  it("rolls back campaign and fan-out if delivery insertion fails", async () => {
    const db = database({ one: "123456" });
    audience.getGuardianAudienceWithDatabase.mockResolvedValue({ missingInterests: [recipient("one")] });
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
    await expect(launchProfileInterestsCampaignWithDatabase(db, "admin", draft)).rejects.toThrow("delivery insert failed");
    expect(db.sql.at(-1)).toBe("ROLLBACK");
    expect(db.state).toEqual({ campaign: null, notifications: [], deliveries: [] });
  });
});

function stateOf(db: ReturnType<typeof database>) {
  return { notifications: db.state.notifications, deliveries: db.state.deliveries };
}
