import { describe, expect, it, vi } from "vitest";
import { getGuardianDeparturesWithDatabase, getGuardianDepartureSummaryWithDatabase, departureDate, departuresInPeriod } from "./guardian-departures";

describe("Guardian departure history", () => {
  it("counts immutable departures and returns newest first without filtering current members", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [
      { id: 2, participant_id: "returned", display_name: "Вернувшийся", event_type: "forum.removed", observed_at: "2026-10-05T10:00:00Z", recent: true },
      { id: 1, participant_id: "older", display_name: "Ранее", event_type: "forum.left", observed_at: "2026-08-01T10:00:00Z", recent: false, archived_username: "@former", archived_display_name: "Архивное имя" },
    ] });
    const result = await getGuardianDeparturesWithDatabase({ query });
    expect(result).toMatchObject({ total: 2, last30Days: 1 });
    expect(result.events.map((event) => event.id)).toEqual(["2", "1"]);
    expect(result.events[1]).toMatchObject({ archivedUsername: "@former", archivedDisplayName: "Архивное имя" });
    const sql = query.mock.calls[0][0];
    expect(sql).toContain("interval '30 days'");
    expect(sql).toContain("ORDER BY observed_at DESC, event.id DESC");
    expect(sql).not.toContain("forum_status");
    expect(sql).not.toMatch(/INSERT|UPDATE|DELETE/);
  });

  it("loads compact summary with counts only, preserving historical occurrence time", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ total: "40", last_30_days: "2" }] });
    expect(await getGuardianDepartureSummaryWithDatabase({ query })).toEqual({ total: 40, last30Days: 2 });
    expect(query.mock.calls[0][0]).toContain("count(DISTINCT COALESCE(participant_id::text");
    expect(query.mock.calls[0][0]).toContain("COALESCE((payload->>'observed_at')::timestamptz, created_at)");
    expect(query.mock.calls[0][0]).not.toContain("display_name");
  });

  it("counts repeated departures once per participant and retains all events", async () => {
    const result = await getGuardianDeparturesWithDatabase({ query: vi.fn().mockResolvedValue({ rows: [
      { id: 3, participant_id: "same", event_type: "forum.left", observed_at: "2026-10-05T10:00:00Z", recent: true },
      { id: 2, participant_id: "same", event_type: "forum.removed", observed_at: "2026-10-04T10:00:00Z", recent: true },
      { id: 1, participant_id: "other", event_type: "forum.left", observed_at: "2020-01-01T10:00:00Z", recent: false },
    ] }) });
    expect(result).toMatchObject({ total: 2, last30Days: 1 });
    expect(result.events).toHaveLength(3);
    expect(departuresInPeriod(result.events, { from: "2026-10-05", to: "2026-10-05" }).map(e => e.id)).toEqual(["3"]);
    expect(departuresInPeriod(result.events, { from: "2026-10-06", to: "2026-10-05" })).toEqual([]);
  });
  it("ignores malformed or impossible dates", () => {
    for (const value of ["2026-02-30", "2026-13-01", "2026-1-01", ["2026-10-01"], undefined]) expect(departureDate(value)).toBeUndefined();
    expect(departureDate("2026-10-01")).toBe("2026-10-01");
  });
  it("handles an empty history", async () => {
    expect(await getGuardianDeparturesWithDatabase({ query: vi.fn().mockResolvedValue({ rows: [] }) }))
      .toEqual({ total: 0, last30Days: 0, events: [] });
  });
});
