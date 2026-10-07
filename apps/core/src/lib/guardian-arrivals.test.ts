import { describe, expect, it, vi } from "vitest";
import { getGuardianArrivalsWithDatabase, getGuardianArrivalSummaryWithDatabase } from "./guardian-arrivals";

describe("Guardian arrival history", () => {
  it("returns forum joins newest first with Telegram username and no writes", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [
      { id: 2, participant_id: "back", display_name: "Вернувшийся", event_type: "forum.rejoined", username: "back_user", observed_at: "2026-10-05T10:00:00Z", recent: true },
      { id: 1, participant_id: "first", display_name: "Новый", event_type: "forum.joined", username: null, observed_at: "2026-08-01T10:00:00Z", recent: false },
    ] });
    const result = await getGuardianArrivalsWithDatabase({ query });
    expect(result).toMatchObject({ total: 2, last30Days: 1 });
    expect(result.events.map((event) => event.id)).toEqual(["2", "1"]);
    expect(result.events[0]).toMatchObject({ username: "back_user", type: "forum.rejoined" });
    expect(result.events[1].username).toBeNull();
    const sql = query.mock.calls[0][0];
    expect(sql).toContain("event.event_type IN ('forum.joined', 'forum.rejoined')");
    expect(sql).toContain("ORDER BY observed_at DESC, event.id DESC");
    expect(sql).not.toMatch(/INSERT|UPDATE|DELETE/);
  });

  it("loads compact summary with counts only", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ total: "25", last_30_days: "7" }] });
    expect(await getGuardianArrivalSummaryWithDatabase({ query })).toEqual({ total: 25, last30Days: 7 });
    expect(query.mock.calls[0][0]).toContain("'forum.joined', 'forum.rejoined'");
    expect(query.mock.calls[0][0]).not.toContain("display_name");
  });

  it("handles an empty history", async () => {
    expect(await getGuardianArrivalsWithDatabase({ query: vi.fn().mockResolvedValue({ rows: [] }) }))
      .toEqual({ total: 0, last30Days: 0, events: [] });
  });
});
