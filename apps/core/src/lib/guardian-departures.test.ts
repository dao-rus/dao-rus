import { describe, expect, it, vi } from "vitest";
import { getGuardianDeparturesWithDatabase } from "./guardian-departures";

describe("Guardian departure history", () => {
  it("counts immutable departures and returns newest first without filtering current members", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [
      { id: 2, participant_id: "returned", display_name: "Вернувшийся", event_type: "forum.removed", observed_at: "2026-10-05T10:00:00Z", recent: true },
      { id: 1, participant_id: "older", display_name: "Ранее", event_type: "forum.left", observed_at: "2026-08-01T10:00:00Z", recent: false },
    ] });
    const result = await getGuardianDeparturesWithDatabase({ query });
    expect(result).toMatchObject({ total: 2, last30Days: 1 });
    expect(result.events.map((event) => event.id)).toEqual(["2", "1"]);
    const sql = query.mock.calls[0][0];
    expect(sql).toContain("interval '30 days'");
    expect(sql).toContain("ORDER BY observed_at DESC, event.id DESC");
    expect(sql).not.toContain("forum_status");
    expect(sql).not.toMatch(/INSERT|UPDATE|DELETE/);
  });

  it("handles an empty history", async () => {
    expect(await getGuardianDeparturesWithDatabase({ query: vi.fn().mockResolvedValue({ rows: [] }) }))
      .toEqual({ total: 0, last30Days: 0, events: [] });
  });
});
