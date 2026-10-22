import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigration, migrationFile } from "./migration-integrity";

const databaseUrl = process.env.GUARDIAN_FORUM_TEST_DATABASE_URL;
const schema = `profile_residence_test_${randomUUID().replaceAll("-", "")}`;
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 4 });
const directory = new URL("../../migrations/", import.meta.url);
const files = readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()
  .map((name) => migrationFile(name, readFileSync(new URL(name, directory), "utf8")));
let schemaCreated = false;

describe.skipIf(!databaseUrl)("participant residence unification migration", () => {
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/guardian_forum_tests") {
      throw new Error("Use the isolated local guardian_forum_tests database");
    }
    await pool.query(`CREATE SCHEMA ${schema}`);
    schemaCreated = true;
    await pool.query("CREATE TABLE schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    for (const file of files.filter((candidate) => candidate.name < "063_")) {
      const client = await pool.connect();
      try { await applyMigration(client, file); } finally { client.release(); }
    }
  }, 60000);

  afterAll(async () => {
    if (schemaCreated) await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  });

  it("preserves free text, leaves established residence intact, and records conflicts", async () => {
    const freeText = randomUUID();
    const established = randomUUID();
    const conflict = randomUUID();
    await pool.query(`INSERT INTO participants(id, display_name, profile_city) VALUES
      ($1, 'Free text', 'Киров Калужская область'),
      ($2, 'Established', NULL),
      ($3, 'Conflict', 'Киров')`, [freeText, established, conflict]);
    await pool.query("UPDATE participants SET residence_name='Москва', residence_type='город', residence_country='Россия' WHERE id=$1", [established]);
    await pool.query("UPDATE participants SET residence_name='Тула', residence_type='город', residence_country='Россия' WHERE id=$1", [conflict]);

    const migration = files.find((file) => file.name === "063_unify_participant_residence.sql")!;
    const client = await pool.connect();
    try { await applyMigration(client, migration); } finally { client.release(); }

    expect((await pool.query("SELECT residence_name, profile_city FROM participants WHERE id=$1", [freeText])).rows[0])
      .toEqual({ residence_name: "Киров Калужская область", profile_city: "Киров Калужская область" });
    expect((await pool.query("SELECT residence_name, residence_type, residence_country FROM participants WHERE id=$1", [established])).rows[0])
      .toEqual({ residence_name: "Москва", residence_type: "город", residence_country: "Россия" });
    expect((await pool.query("SELECT profile_city, residence_name FROM participants WHERE id=$1", [conflict])).rows[0])
      .toEqual({ profile_city: "Киров", residence_name: "Тула" });
    expect((await pool.query("SELECT profile_city, residence_name, residence_type, residence_country, status FROM participant_residence_conflicts WHERE participant_id=$1", [conflict])).rows[0])
      .toEqual({ profile_city: "Киров", residence_name: "Тула", residence_type: "город", residence_country: "Россия", status: "open" });
  });
});
