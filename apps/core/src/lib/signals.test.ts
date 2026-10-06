import { describe, expect, it, vi } from "vitest";
import {
  getSignalWithDatabase, listNetworkSignalsWithDatabase, listParticipantSignalsWithDatabase,
  updateSignalWithDatabase, requireEnabledSignalTypeWithDatabase, createSignalWithDatabase, searchNetworkSignalsWithDatabase,
  getGuestShareableSignalWithDatabase, SignalValidationError, type SignalReader,
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

  it("reads a permalink with shared network access and canonical fields", async () => {
    const id = "10000000-0000-4000-8000-000000000001";
    const db = database([{ ...row, id, mine: false, author_id: "owner", author_name: "Автор", body: "Obsolete" }]);
    expect(await getSignalWithDatabase(db, "viewer", id)).toMatchObject({ id, label: "Ядро", description: "Условия", author: { id: "owner", name: "Автор" } });
    const [sql, values] = db.query.mock.calls[0];
    expect(values).toEqual(["viewer", id]);
    expect(sql).toContain("s.id = $2::uuid");
    expect(sql).toContain("s.participant_id = $1::uuid OR (s.status = 'active' AND s.visibility IN ('public', 'members', 'network_blind'))");
    expect(sql).not.toContain("s.body");
    expect(sql).not.toContain("username");
  });
  it("returns the same null for unavailable/nonexistent IDs and rejects malformed IDs before SQL", async () => {
    const db = database([]);
    const id = "10000000-0000-4000-8000-000000000001";
    expect(await getSignalWithDatabase(db, "viewer", id)).toBeNull();
    db.query.mockClear();
    for (const value of ["../private", "not-a-uuid", "", null, undefined]) {
      expect(await getSignalWithDatabase(db, "viewer", value)).toBeNull();
    }
    expect(db.query).not.toHaveBeenCalled();
  });
  it("reads any active public Signal for guests with a minimal projection", async () => {
    const id = "10000000-0000-4000-8000-000000000001";
    const db = database([{ id, kind: "need", label: "Работа", description: "В СПб", author_name: "Надежда" }]);
    expect(await getGuestShareableSignalWithDatabase(db, id)).toEqual({
      id, typeKey: "need", label: "Работа", description: "В СПб", authorName: "Надежда",
    });
    const [sql, values] = db.query.mock.calls[0];
    expect(values).toEqual([id]);
    expect(sql).toContain("s.status = 'active' AND s.visibility = 'public'");
    expect(sql).not.toContain("external_share_enabled");
    expect(sql).not.toContain("owner_id");
    expect(sql).not.toContain("s.body");
    db.query.mockClear();
    expect(await getGuestShareableSignalWithDatabase(db, "invalid")).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
  });
  it.each([false, true])("masks blind permalink identity, including for owner=%s", async (mine) => {
    const id = "10000000-0000-4000-8000-000000000001";
    const db = database([{ ...row, id, kind: "need", visibility: "network_blind", mine,
      author_id: "hidden-owner", owner_id: "hidden-owner", author_name: "Hidden name", username: "@hidden" }]);
    const signal = await getSignalWithDatabase(db, "viewer", id);
    expect(signal).toMatchObject({ ownerId: null, author: null, mine });
    expect(JSON.stringify(signal)).not.toContain("hidden");
    expect(JSON.stringify(signal)).not.toContain("Hidden name");
  });
  it("uses the same active network privacy predicate for Angel Search", async () => {
    const db = database([{ ...row, mine: false, author_id: "owner", author_name: "Автор" }]);
    await searchNetworkSignalsWithDatabase(db, "viewer", { typeKeys: ["future_type"], terms: ["Ядро", "Условия"] });
    const [sql, values] = db.query.mock.calls[0];
    expect(values).toEqual(["viewer", ["future_type"], ["Ядро", "Условия"]]);
    expect(sql).toContain("s.status = 'active'");
    expect(sql).toContain("s.visibility IN ('public', 'members', 'network_blind')");
    expect(sql).toContain("s.kind = ANY($2::text[])");
    expect(sql).toContain("s.label NOT ILIKE");
    expect(sql).not.toContain("private"); expect(sql).not.toContain("match_only"); expect(sql).not.toContain("circle");
  });
  it("escapes LIKE metacharacters literally including the chosen escape character", async () => {
    const db = database([]);
    await searchNetworkSignalsWithDatabase(db, "viewer", { typeKeys: [], terms: ["%", "_", "!", "100% SQL_admin!", "normal phrase"] });
    const [sql, values] = db.query.mock.calls[0];
    expect(values).toEqual(["viewer", [], ["!%", "!_", "!!", "100!% SQL!_admin!!", "normal phrase"]]);
    expect(sql.match(/ESCAPE '!'/g)).toHaveLength(2);
  });

});
