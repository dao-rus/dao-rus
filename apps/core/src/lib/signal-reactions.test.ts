import { describe, expect, it, vi } from "vitest";
import { readPublicSignalReactionCountWithDatabase, readSignalReactionStateWithDatabase, setSignalReactionWithDatabase,
  SignalReactionUnavailableError } from "./signal-reactions";

const id = "10000000-0000-4000-8000-000000000001";

describe("Signal reactions", () => {
  it("counts likes for guests only on active public Signals and never creates reactions", async () => {
    const query = vi.fn(async () => ({ rowCount: 1, rows: [{ count: 4 }] }));
    expect(await readPublicSignalReactionCountWithDatabase({ query }, id)).toBe(4);
    const [sql] = query.mock.calls[0] as unknown as [string];
    expect(sql).toContain("signal.status = 'active' AND signal.visibility = 'public'");
    expect(sql.startsWith("SELECT")).toBe(true);
    query.mockClear();
    expect(await readPublicSignalReactionCountWithDatabase({ query }, "invalid")).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it("adds once, removes once, counts active reactions and audits only Signal IDs", async () => {
    let active = false;
    const sql: string[] = [];
    const events: unknown[][] = [];
    const client = { release: vi.fn(), query: vi.fn(async (text: string, values?: unknown[]) => {
      sql.push(text);
      if (text.startsWith("SELECT id FROM profile_signals")) return { rowCount: 1, rows: [{ id }] };
      if (text.startsWith("INSERT INTO signal_reactions")) {
        if (active) return { rowCount: 0, rows: [] };
        active = true; return { rowCount: 1, rows: [{ id: "reaction-id" }] };
      }
      if (text.startsWith("UPDATE signal_reactions")) {
        if (!active) return { rowCount: 0, rows: [] };
        active = false; return { rowCount: 1, rows: [{ id: "reaction-id" }] };
      }
      if (text.startsWith("INSERT INTO events")) events.push(values ?? []);
      if (text.startsWith("SELECT count(")) return { rowCount: 1, rows: [{ count: Number(active), reacted: active }] };
      return { rowCount: 1, rows: [] };
    }) };
    const db = { query: client.query, connect: vi.fn(async () => client) };
    expect(await setSignalReactionWithDatabase(db, "actor", id, true)).toBe(true);
    expect(await setSignalReactionWithDatabase(db, "actor", id, true)).toBe(false);
    expect(await readSignalReactionStateWithDatabase(db, id, "actor")).toEqual({ count: 1, reacted: true });
    expect(await setSignalReactionWithDatabase(db, "actor", id, false)).toBe(true);
    expect(await setSignalReactionWithDatabase(db, "actor", id, false)).toBe(false);
    expect(await readSignalReactionStateWithDatabase(db, id, "actor")).toEqual({ count: 0, reacted: false });
    expect(events).toHaveLength(2);
    expect(events[0][0]).toBe("signal.reaction_added");
    expect(events[1][0]).toBe("signal.reaction_removed");
    expect(sql.join(" ")).not.toMatch(/reputation_signals|darus_ledger|reward_rules/);
  });
  it("rejects unavailable or own Signals before writing", async () => {
    const client = { release: vi.fn(), query: vi.fn(async (sql: string) => ({
      rowCount: sql.startsWith("SELECT id FROM profile_signals") ? 0 : 1, rows: [],
    })) };
    const db = { query: client.query, connect: vi.fn(async () => client) };
    await expect(setSignalReactionWithDatabase(db, "owner", id, true)).rejects.toBeInstanceOf(SignalReactionUnavailableError);
    expect(client.query.mock.calls.some(([sql]) => sql.startsWith("INSERT INTO signal_reactions"))).toBe(false);
    expect(client.query.mock.calls.some(([sql]) => sql === "ROLLBACK")).toBe(true);
    db.connect.mockClear();
    await expect(setSignalReactionWithDatabase(db, "owner", "invalid", true)).rejects.toBeInstanceOf(SignalReactionUnavailableError);
    expect(db.connect).not.toHaveBeenCalled();
  });
});
