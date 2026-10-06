import { describe, expect, it, vi } from "vitest";
import {
  listNetworkSignalsWithDatabase, listParticipantSignalsWithDatabase,
  updateSignalWithDatabase, requireEnabledSignalTypeWithDatabase, createSignalWithDatabase, SignalValidationError, type SignalReader,
} from "./signals";
import { signalBodyProjection } from "./signal-compat";

const row = {
  id: "signal", kind: "future_type", owner_id: "owner", label: "Ядро", description: "Условия",
  visibility: "members", status: "active", legacy_body: false,
  created_at: new Date("2026-10-06T09:00:00Z"), updated_at: new Date("2026-10-06T09:00:00Z"),
};
function database(rows: Array<Record<string, unknown>>) {
  return { query: vi.fn<SignalReader["query"]>(async () => ({ rowCount: rows.length, rows })) };
}

describe("universal Signal types and reads", () => {
  it("validates universal content/visibility before opening a transaction", async () => {
    const db = { ...database([]), connect: vi.fn(async () => { throw new Error("unexpected connection"); }) };
    for (const input of [
      { typeKey: "skill", label: "", visibility: "members" },
      { typeKey: "skill", label: "я".repeat(121), visibility: "members" },
      { typeKey: "skill", label: "Тест", description: "я".repeat(10001), visibility: "members" },
      { typeKey: "skill", label: "Тест", visibility: "network_blind" },
    ]) {
      await expect(createSignalWithDatabase(db, "owner", input)).rejects.toBeInstanceOf(SignalValidationError);
    }
    expect(db.connect).not.toHaveBeenCalled();
  });

  it("looks up arbitrary enabled catalogue keys using stable keys rather than display names", async () => {
    const db = database([{ key: "future_type", display_name: "Любое название", enabled: true }]);
    expect(await requireEnabledSignalTypeWithDatabase(db, "future_type"))
      .toEqual({ key: "future_type", displayName: "Любое название", enabled: true });
    expect(db.query.mock.calls[0][1]).toEqual(["future_type"]);
    expect(db.query.mock.calls[0][0]).toContain("enabled = true");
  });

  it.each(["unknown", "disabled"])("rejects unavailable catalogue entries (%s)", async (typeKey) => {
    await expect(requireEnabledSignalTypeWithDatabase(database([]), typeKey))
      .rejects.toBeInstanceOf(SignalValidationError);
  });

  it("returns canonical fields, ownership, lifecycle and timestamps without legacy body", async () => {
    const db = database([{ ...row, body: "Conflicting obsolete projection" }]);
    const [signal] = await listParticipantSignalsWithDatabase(db, "owner", "owner");
    expect(signal).toEqual({
      id: "signal", ownerId: "owner", typeKey: "future_type", label: "Ядро", description: "Условия",
      visibility: "members", status: "active", legacyBody: false,
      createdAt: row.created_at, updatedAt: row.updated_at,
    });
    expect(signal).not.toHaveProperty("body");
    expect(signalBodyProjection(signal)).toBe("Ядро\n\nУсловия");
    expect(db.query.mock.calls[0][0]).not.toContain("s.body");
  });

  it("does not normalize or truncate inherited content when reading or projecting it", async () => {
    const text = "  " + "я".repeat(900) + "\n  ";
    const [signal] = await listParticipantSignalsWithDatabase(database([
      { ...row, label: text, description: null, legacy_body: true },
    ]), "owner", "owner");
    expect(signal.label).toBe(text);
    expect(signal.legacyBody).toBe(true);
    expect(signalBodyProjection(signal)).toBe(text);
  });

  it("retains profile privacy filtering and refuses inactive foreign profile reads", async () => {
    const db = database([]);
    await listParticipantSignalsWithDatabase(db, "owner", "viewer");
    expect(db.query.mock.calls[0][0]).toContain("s.visibility IN ('public', 'members')");
    expect(db.query.mock.calls[0][1]).toEqual(["owner", "active"]);
    db.query.mockClear();
    expect(await listParticipantSignalsWithDatabase(db, "owner", "viewer", "archived")).toEqual([]);
    expect(await listParticipantSignalsWithDatabase(db, "owner", "viewer", "closed")).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("allows the author to read their archived records without widening other readers' access", async () => {
    const db = database([{ ...row, visibility: "private", status: "archived" }]);
    expect((await listParticipantSignalsWithDatabase(db, "owner", "owner", "archived"))[0])
      .toMatchObject({ ownerId: "owner", status: "archived", visibility: "private" });
    expect(db.query.mock.calls[0][1]).toEqual(["owner", "archived"]);
    expect(db.query.mock.calls[0][0]).not.toContain("visibility IN");
  });

  it("redacts every blind owner/author field even if a database row contains them", async () => {
    const db = database([
      { ...row, kind: "need", visibility: "network_blind", mine: false, author_id: "owner", author_name: "Hidden name" },
      { ...row, kind: "need", visibility: "network_blind", mine: true, author_id: "owner", author_name: "Hidden name" },
    ]);
    const signals = await listNetworkSignalsWithDatabase(db, "viewer", "need");
    expect(signals.every((signal) => signal.ownerId === null && signal.author === null)).toBe(true);
    expect(signals.map((signal) => signal.mine)).toEqual([false, true]);
    expect(JSON.stringify(signals)).not.toContain("Hidden name");
    const sql = db.query.mock.calls[0][0];
    expect(sql).toContain("CASE WHEN s.visibility <> 'network_blind' THEN s.participant_id END AS owner_id");
    expect(sql).toContain("s.visibility IN ('public', 'members', 'network_blind')");
    expect(sql).toContain("s.status = 'active'");
    expect(sql).toContain("ORDER BY s.created_at DESC, s.id DESC LIMIT 100");
  });
  it("updates canonical content under owner and active locks without mint or enabled-type restriction", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("SELECT kind")) return { rowCount: 1, rows: [{ kind: "later_disabled" }] };
      if (sql.startsWith("UPDATE")) return { rowCount: 1, rows: [{ ...row, kind: "later_disabled", legacy_body: false, description: null }] };
      return { rowCount: 0, rows: [] };
    });
    const client = { query, release: vi.fn() };
    const db = { query, connect: vi.fn(async () => client) };
    const updated = await updateSignalWithDatabase(db, "owner", "signal", { label: "Ядро", visibility: "members" });
    expect(updated.legacyBody).toBe(false);
    const lock = query.mock.calls[1][0];
    expect(lock).toContain("participant_id = $2::uuid AND status = 'active' FOR UPDATE");
    const sql = query.mock.calls.find(([sql]) => sql.startsWith("UPDATE"))![0];
    expect(sql).toContain("legacy_body = false");
    expect(sql).not.toContain("SET body");
    expect(query.mock.calls.some(([sql]) => sql.includes("reward") || sql.includes("signal_types"))).toBe(false);
    expect(query.mock.calls.at(-1)![0]).toBe("COMMIT");
  });
  it("refuses unavailable owner records and invalid labels before any update", async () => {
    const query = vi.fn(async () => ({ rowCount: 0, rows: [] }));
    const client = { query, release: vi.fn() };
    const db = { query, connect: vi.fn(async () => client) };
    await expect(updateSignalWithDatabase(db, "viewer", "signal", { label: "Ядро", visibility: "members" })).rejects.toThrow("Signal unavailable");
    expect(query.mock.calls.flat().join(" ")).not.toContain("UPDATE profile_signals");
    db.connect.mockClear();
    await expect(updateSignalWithDatabase(db, "owner", "signal", { label: "я".repeat(121), visibility: "private" })).rejects.toThrow("too long");
    expect(db.connect).not.toHaveBeenCalled();
  });

});
