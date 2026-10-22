import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigration, migrationFile } from "./migration-integrity";

const databaseUrl = process.env.GUARDIAN_FORUM_TEST_DATABASE_URL;
const schema = `profile_resources_test_${randomUUID().replaceAll("-", "")}`;
const pool = databaseUrl
  ? new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 2 })
  : null;
let schemaCreated = false;

describe.skipIf(!databaseUrl)("participant profile resources migration", () => {
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/guardian_forum_tests") {
      throw new Error("Use the isolated local guardian_forum_tests database");
    }
    await pool!.query(`CREATE SCHEMA ${schema}`);
    schemaCreated = true;
    await pool!.query("CREATE TABLE participants(id uuid PRIMARY KEY)");
    await pool!.query("CREATE TABLE schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    const migration = migrationFile("065_participant_profile_resources.sql",
      readFileSync(new URL("../../migrations/065_participant_profile_resources.sql", import.meta.url), "utf8"));
    const client = await pool!.connect();
    try { await applyMigration(client, migration); } finally { client.release(); }
  }, 30000);

  afterAll(async () => {
    if (schemaCreated) await pool!.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool?.end();
  });

  it("enforces owner-scoped uniqueness and prevents deleting another owner's link", async () => {
    const owner = randomUUID();
    const other = randomUUID();
    const resourceId = randomUUID();
    await pool!.query("INSERT INTO participants(id) VALUES ($1), ($2)", [owner, other]);
    await pool!.query("INSERT INTO participant_profile_resources(id, participant_id, url, normalized_url) VALUES ($1, $2, $3, $4)",
      [resourceId, owner, "https://example.org/", "https://example.org/"]);
    await expect(pool!.query("INSERT INTO participant_profile_resources(participant_id, url, normalized_url) VALUES ($1, $2, $3)",
      [owner, "https://example.org/#fragment", "https://example.org/"]))
      .rejects.toMatchObject({ code: "23505" });
    const removed = await pool!.query("DELETE FROM participant_profile_resources WHERE id=$1 AND participant_id=$2", [resourceId, other]);
    expect(removed.rowCount).toBe(0);
    expect((await pool!.query("SELECT participant_id FROM participant_profile_resources WHERE id=$1", [resourceId])).rows[0].participant_id).toBe(owner);
  });
});
