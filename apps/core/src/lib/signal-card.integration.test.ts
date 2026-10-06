import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigration, migrationFile } from "./migration-integrity";
import { readSignalReactionStateWithDatabase, setSignalReactionWithDatabase } from "./signal-reactions";
import { archiveSignalWithDatabase, createSignalWithDatabase, getGuestShareableSignalWithDatabase,
  updateSignalWithDatabase } from "./signals";

const databaseUrl = process.env.SIGNAL_TEST_DATABASE_URL;
const schema = `signal_card_test_${randomUUID().replaceAll("-", "")}`;
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 12 });
const directory = new URL("../../migrations/", import.meta.url);
const migrations = readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()
  .map((name) => migrationFile(name, readFileSync(new URL(name, directory), "utf8")));
let schemaCreated = false;
let owner: string, viewer: string;

async function counts() {
  const result = await pool.query(`SELECT
    (SELECT count(*)::int FROM reputation_signals) AS reputation,
    (SELECT count(*)::int FROM darus_ledger) AS ledger`);
  return result.rows[0];
}

describe.skipIf(!databaseUrl)("Signal card sharing and reactions on PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/signal_tests") {
      throw new Error("Use only the isolated local signal_tests database");
    }
    await pool.query(`CREATE SCHEMA ${schema}`);
    schemaCreated = true;
    await pool.query("CREATE TABLE schema_migrations(name text PRIMARY KEY, checksum text NOT NULL)");
    for (const migration of migrations) {
      const client = await pool.connect();
      try { await applyMigration(client, migration); } finally { client.release(); }
    }
    owner = randomUUID(); viewer = randomUUID();
    await pool.query("INSERT INTO participants(id,display_name) VALUES ($1,'Владелец'),($2,'Читатель')", [owner, viewer]);
  }, 60000);

  afterAll(async () => {
    if (schemaCreated) await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  });

  it("opens only active public Signals to guests, whatever the deprecated share column says", async () => {
    for (const visibility of ["public", "members", "private", "circle", "match_only", "network_blind"] as const) {
      const { signal } = await createSignalWithDatabase(pool, owner, { typeKey: "need", label: visibility, visibility });
      await pool.query("UPDATE profile_signals SET external_share_enabled=$2 WHERE id=$1", [signal.id, visibility !== "public"]);
      const guest = await getGuestShareableSignalWithDatabase(pool, signal.id);
      if (visibility !== "public") { expect(guest).toBeNull(); continue; }
      expect(guest).toEqual({ id: signal.id, typeKey: "need", label: visibility, description: null, authorName: "Владелец" });
      await updateSignalWithDatabase(pool, owner, signal.id, { label: visibility, visibility: "members" });
      expect(await getGuestShareableSignalWithDatabase(pool, signal.id)).toBeNull();
      await updateSignalWithDatabase(pool, owner, signal.id, { label: visibility, visibility: "public" });
      expect(await getGuestShareableSignalWithDatabase(pool, signal.id)).not.toBeNull();
      await archiveSignalWithDatabase(pool, owner, signal.id);
      expect(await getGuestShareableSignalWithDatabase(pool, signal.id)).toBeNull();
    }
    const { signal: closed } = await createSignalWithDatabase(pool, owner, { typeKey: "search", label: "closed", visibility: "public" });
    await pool.query("UPDATE profile_signals SET status='closed' WHERE id=$1", [closed.id]);
    expect(await getGuestShareableSignalWithDatabase(pool, closed.id)).toBeNull();
  });

  it("keeps reactions unique, revocable, independent of reputation and DARUS", async () => {
    const { signal } = await createSignalWithDatabase(pool, owner, {
      typeKey: "search", label: "Нужен совет", visibility: "members",
    });
    const before = await counts();
    await expect(setSignalReactionWithDatabase(pool, owner, signal.id, true)).rejects.toThrow();
    await expect(pool.query(
      "INSERT INTO signal_reactions(signal_id,actor_participant_id) VALUES ($1,$2)", [signal.id, owner],
    )).rejects.toThrow();
    const adds = await Promise.all([
      setSignalReactionWithDatabase(pool, viewer, signal.id, true),
      setSignalReactionWithDatabase(pool, viewer, signal.id, true),
    ]);
    expect(adds.sort()).toEqual([false, true]);
    expect(await readSignalReactionStateWithDatabase(pool, signal.id, viewer))
      .toEqual({ count: 1, reacted: true });
    expect(await setSignalReactionWithDatabase(pool, viewer, signal.id, false)).toBe(true);
    expect(await setSignalReactionWithDatabase(pool, viewer, signal.id, false)).toBe(false);
    expect(await readSignalReactionStateWithDatabase(pool, signal.id, viewer))
      .toEqual({ count: 0, reacted: false });
    expect(await setSignalReactionWithDatabase(pool, viewer, signal.id, true)).toBe(true);
    expect(await readSignalReactionStateWithDatabase(pool, signal.id, viewer))
      .toEqual({ count: 1, reacted: true });
    const history = await pool.query("SELECT revoked_at FROM signal_reactions WHERE signal_id=$1 ORDER BY created_at", [signal.id]);
    expect(history.rowCount).toBe(2);
    expect(history.rows.filter((row) => row.revoked_at === null)).toHaveLength(1);
    await expect(pool.query("DELETE FROM signal_reactions WHERE signal_id=$1", [signal.id])).rejects.toThrow();
    expect(await counts()).toEqual(before);
  });
});
