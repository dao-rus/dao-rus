import { createHash } from "node:crypto";

export const LEGACY_MIGRATION_BASELINES: Readonly<Record<string, string>> = {
  "001_initial.sql":
    "15911df95391a678ec57364181e45203ab23ec963a28e9d06e2f65f5cb06bdd0",
  "002_proposals.sql":
    "f40c0e36359c7846f76cb4e9a571f5f5211dd5ff08ae9574877f0d3bfa7e6f74",
  "003_telegram_ingestion.sql":
    "56c19c3b75768e4d984e3c8f3e1daa23e8b64a90f563e62ff0cbb4fa624f74b6",
  "004_telegram_roster.sql":
    "051fc969c91f82f58186953f0aeebff2d9619c1c341341ccffcbe7ece122ba28",
  "005_participant_registry.sql":
    "6ccfaed657714a86c86cb445442a7fefef6bd8c8e7244454e9fbcbd13a1fa97f",
  "006_membership_binding.sql":
    "42a7f21a087e6408004908a4e7139bda78f059a630db7a91eab468aa0894c4b1",
  "007_telegram_presence.sql":
    "ee0fd5c6527674ecfd91aac9e54a4bd4913c78e2410d3432c63fc733d36f0dad",
  "008_canonical_membership.sql":
    "280ed395ef1b6c07b15be9d26d4bd9adfce684000a0fede67f03dc9573877aab",
};

export type MigrationFile = {
  name: string;
  sql: string;
  checksum: string;
};

export type AppliedMigration = {
  name: string;
  checksum: string | null;
};

export type MigrationPlan = {
  bootstrap: Array<{ name: string; checksum: string }>;
  pending: MigrationFile[];
};

export interface MigrationDatabaseClient {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rowCount: number | null; rows: unknown[] }>;
}

export function normalizeMigrationSql(sql: string): string {
  return sql.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function migrationChecksum(sql: string): string {
  return createHash("sha256")
    .update(normalizeMigrationSql(sql), "utf8")
    .digest("hex");
}

export function migrationFile(name: string, sql: string): MigrationFile {
  return { name, sql, checksum: migrationChecksum(sql) };
}

function assertLegacyBaseline(filesByName: ReadonlyMap<string, MigrationFile>): void {
  for (const [name, expectedChecksum] of Object.entries(
    LEGACY_MIGRATION_BASELINES,
  )) {
    const file = filesByName.get(name);
    if (!file) {
      throw new Error(`Legacy migration baseline file is missing: ${name}`);
    }
    if (file.checksum !== expectedChecksum) {
      throw new Error(`Legacy migration baseline checksum mismatch: ${name}`);
    }
  }
}

export function createMigrationPlan(
  files: readonly MigrationFile[],
  applied: readonly AppliedMigration[],
): MigrationPlan {
  const filesByName = new Map(files.map((file) => [file.name, file]));
  const appliedByName = new Map(applied.map((migration) => [migration.name, migration]));
  const needsLegacyBootstrap = applied.some(
    (migration) => migration.checksum === null,
  );

  if (needsLegacyBootstrap) {
    assertLegacyBaseline(filesByName);
  }

  const bootstrap: MigrationPlan["bootstrap"] = [];

  for (const migration of applied) {
    const file = filesByName.get(migration.name);
    if (!file) {
      throw new Error(`Applied migration file is missing: ${migration.name}`);
    }

    if (migration.checksum === null) {
      const baselineChecksum = LEGACY_MIGRATION_BASELINES[migration.name];
      if (!baselineChecksum) {
        throw new Error(
          `Applied migration has no checksum and is not an approved legacy baseline: ${migration.name}`,
        );
      }
      bootstrap.push({ name: migration.name, checksum: baselineChecksum });
      continue;
    }

    if (migration.checksum !== file.checksum) {
      throw new Error(`Applied migration checksum mismatch: ${migration.name}`);
    }
  }

  return {
    bootstrap,
    pending: files.filter((file) => !appliedByName.has(file.name)),
  };
}

export async function applyMigration(
  client: MigrationDatabaseClient,
  migration: MigrationFile,
): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(migration.sql);
    await client.query(
      "INSERT INTO schema_migrations(name, checksum) VALUES ($1, $2)",
      [migration.name, migration.checksum],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
