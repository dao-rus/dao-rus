import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import {
  applyMigration,
  createMigrationPlan,
  migrationFile,
  type AppliedMigration,
} from "../src/lib/migration-integrity";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const pool = new Pool({ connectionString: databaseUrl });

async function main() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now(),
        checksum text NOT NULL
      )
    `);
    await client.query(
      "ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text",
    );

    const migrationsDir = path.join(process.cwd(), "migrations");
    const names = (await fs.readdir(migrationsDir))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const files = await Promise.all(
      names.map(async (name) =>
        migrationFile(
          name,
          await fs.readFile(path.join(migrationsDir, name), "utf8"),
        ),
      ),
    );

    await client.query("BEGIN");
    let plan;
    try {
      await client.query(
        "LOCK TABLE schema_migrations IN SHARE ROW EXCLUSIVE MODE",
      );
      const appliedResult = await client.query<AppliedMigration>(
        "SELECT name, checksum FROM schema_migrations ORDER BY name",
      );
      plan = createMigrationPlan(files, appliedResult.rows);

      for (const migration of plan.bootstrap) {
        const result = await client.query(
          `UPDATE schema_migrations
           SET checksum = $2
           WHERE name = $1 AND checksum IS NULL`,
          [migration.name, migration.checksum],
        );
        if (result.rowCount !== 1) {
          throw new Error(
            `Legacy migration checksum bootstrap conflict: ${migration.name}`,
          );
        }
      }

      await client.query(
        "ALTER TABLE schema_migrations ALTER COLUMN checksum SET NOT NULL",
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }

    for (const migration of plan.pending) {
      await applyMigration(client, migration);
      console.log(`Applied migration: ${migration.name}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
