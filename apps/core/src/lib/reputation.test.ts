import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  getReputationSummaryWithDatabase,
  ReputationValidationError,
  setReputationSignalWithDatabase,
} from "./reputation";

const actorId = "10000000-0000-4000-8000-000000000001";
const subjectId = "20000000-0000-4000-8000-000000000002";

class FakeClient {
  // The snapshot models transaction rollback for the in-memory test database.
  queries: Array<{ text: string; values?: unknown[] }> = [];
  active: { id: string; signal_type: string } | null = null;
  history: Array<{ id: string; signal_type: string; revoked: boolean }> = [];
  events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  failEvent = false;
  released = false;
  snapshot: { history: Array<{ id: string; signal_type: string; revoked: boolean }>; events: Array<{ type: string; payload: Record<string, unknown> }>; active: { id: string; signal_type: string } | null } | null = null;

  async query(text: string, values?: unknown[]) {
    this.queries.push({ text, values });
    if (text === "BEGIN") this.snapshot = {
      history: this.history.map((row) => ({ ...row })), events: [...this.events],
      active: this.active ? { ...this.active } : null,
    };
    if (text === "ROLLBACK" && this.snapshot) {
      this.history = this.snapshot.history;
      this.events = this.snapshot.events;
      this.active = this.snapshot.active;
    }
    if (text.includes("FROM participants WHERE id")) return { rowCount: 1, rows: [{ id: values?.[0] }] };
    if (text.includes("SELECT id, signal_type FROM reputation_signals")) return { rowCount: this.active ? 1 : 0, rows: this.active ? [this.active] : [] };
    if (text.startsWith("UPDATE reputation_signals")) {
      this.active = null;
      this.history.at(-1)!.revoked = true;
    }
    if (text.startsWith("INSERT INTO reputation_signals")) {
      const row = { id: `signal-${this.history.length + 1}`, signal_type: String(values?.[2]), revoked: false };
      this.history.push(row);
      this.active = row;
      return { rowCount: 1, rows: [{ id: row.id }] };
    }
    if (text.startsWith("INSERT INTO events")) {
      if (this.failEvent) throw new Error("event write failed");
      this.events.push({ type: String(values?.[0]), payload: JSON.parse(String(values?.[2])) });
    }
    return { rowCount: 0, rows: [] };
  }
  release() { this.released = true; }
}

describe("reputation signals", () => {
  it("creates, changes, and revokes while retaining all rows and one event per action", async () => {
    const client = new FakeClient();
    const database = { connect: async () => client, query: client.query.bind(client) };
    expect(await setReputationSignalWithDatabase(database, actorId, subjectId, "positive")).toBe("created");
    expect(await setReputationSignalWithDatabase(database, actorId, subjectId, "positive")).toBe("unchanged");
    expect(await setReputationSignalWithDatabase(database, actorId, subjectId, "quality_flag")).toBe("changed");
    expect(await setReputationSignalWithDatabase(database, actorId, subjectId, "revoke")).toBe("revoked");
    expect(client.history).toEqual([
      { id: "signal-1", signal_type: "positive", revoked: true },
      { id: "signal-2", signal_type: "quality_flag", revoked: true },
    ]);
    expect(client.events.map((event) => event.type)).toEqual([
      "reputation.signal_created", "reputation.signal_changed", "reputation.signal_revoked",
    ]);
    expect(client.events[1].payload).toMatchObject({ previous_signal_id: "signal-1", signal_id: "signal-2" });
    expect(client.queries.filter(({ text }) => text.includes("FOR UPDATE") && text.includes("FROM participants"))).toHaveLength(4);
    expect(client.released).toBe(true);
  });

  it("rejects a self signal before opening a transaction", async () => {
    const client = new FakeClient();
    await expect(setReputationSignalWithDatabase({ connect: async () => client, query: client.query.bind(client) }, actorId, actorId, "positive"))
      .rejects.toBeInstanceOf(ReputationValidationError);
    expect(client.queries).toHaveLength(0);
  });

  it("rolls back a changed signal if its event cannot be recorded", async () => {
    const client = new FakeClient();
    const database = { connect: async () => client, query: client.query.bind(client) };
    await setReputationSignalWithDatabase(database, actorId, subjectId, "positive");
    client.failEvent = true;
    await expect(setReputationSignalWithDatabase(database, actorId, subjectId, "quality_flag"))
      .rejects.toThrow("event write failed");
    expect(client.history).toEqual([{ id: "signal-1", signal_type: "positive", revoked: false }]);
    expect(client.events).toHaveLength(1);
    expect(client.queries.at(-1)?.text).toBe("ROLLBACK");
  });

  it("reads only a positive count and the viewer's own active type", async () => {
    let query = "";
    const result = await getReputationSummaryWithDatabase({ async query(text) {
      query = text;
      return { rowCount: 1, rows: [{ positive_count: 3, viewer_signal: "quality_flag" }] };
    } }, subjectId, actorId);
    expect(result).toEqual({ positiveCount: 3, viewerSignal: "quality_flag" });
    expect(query).toContain("signal_type = 'positive'");
    expect(query).toContain("actor_participant_id = $2::uuid");
    expect(query).not.toContain("actor.display_name");
    expect(query).not.toContain("count(*) FILTER");
  });

  it("defines database guards for self rating, active uniqueness, and immutable history", async () => {
    const migration = await readFile(new URL("../../migrations/017_reputation_signals.sql", import.meta.url), "utf8");
    expect(migration).toContain("CHECK (actor_participant_id <> subject_participant_id)");
    expect(migration).toContain("ON reputation_signals(actor_participant_id, subject_participant_id, dimension)");
    expect(migration).toContain("WHERE revoked_at IS NULL");
    expect(migration).toContain("BEFORE UPDATE OR DELETE ON reputation_signals");
  });
});
