import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  LEGACY_MIGRATION_BASELINES,
  applyMigration,
  createMigrationPlan,
  migrationChecksum,
  migrationFile,
  type AppliedMigration,
  type MigrationDatabaseClient,
  type MigrationFile,
} from "./migration-integrity";

class FakeClient implements MigrationDatabaseClient {
  queries: Array<{ text: string; values?: unknown[] }> = [];
  failInsert = false;

  async query(text: string, values?: unknown[]) {
    this.queries.push({ text, values });
    if (this.failInsert && text.startsWith("INSERT INTO schema_migrations")) {
      throw new Error("insert failed");
    }
    return { rowCount: 1, rows: [] };
  }
}

async function legacyFiles(): Promise<MigrationFile[]> {
  return Promise.all(
    Object.keys(LEGACY_MIGRATION_BASELINES).map(async (name) =>
      migrationFile(
        name,
        await readFile(new URL(`../../migrations/${name}`, import.meta.url), "utf8"),
      ),
    ),
  );
}

describe("migration integrity", () => {
  it("normalizes CRLF and CR to LF without normalizing other content", () => {
    expect(migrationChecksum("SELECT 1;\r\n-- note\r")).toBe(
      migrationChecksum("SELECT 1;\n-- note\n"),
    );
    expect(migrationChecksum("SELECT  1;\n")).not.toBe(
      migrationChecksum("SELECT 1;\n"),
    );
  });

  it("accepts an unchanged applied migration", () => {
    const file = migrationFile("009_example.sql", "SELECT 1;\n");
    const plan = createMigrationPlan(
      [file],
      [{ name: file.name, checksum: file.checksum }],
    );

    expect(plan).toEqual({ bootstrap: [], pending: [] });
  });

  it("fails when an applied migration was changed", () => {
    const current = migrationFile("009_example.sql", "SELECT 2;\n");

    expect(() =>
      createMigrationPlan(
        [current],
        [{ name: current.name, checksum: migrationChecksum("SELECT 1;\n") }],
      ),
    ).toThrow("Applied migration checksum mismatch: 009_example.sql");
  });

  it("fails when an applied migration file is missing", () => {
    expect(() =>
      createMigrationPlan([], [{ name: "009_missing.sql", checksum: "abc" }]),
    ).toThrow("Applied migration file is missing: 009_missing.sql");
  });

  it("does not return a following migration when integrity validation fails", () => {
    const changed = migrationFile("009_changed.sql", "SELECT 2;\n");
    const next = migrationFile("010_next.sql", "SELECT 3;\n");

    expect(() =>
      createMigrationPlan(
        [changed, next],
        [{ name: changed.name, checksum: migrationChecksum("SELECT 1;\n") }],
      ),
    ).toThrow("Applied migration checksum mismatch: 009_changed.sql");
  });

  it("bootstraps legacy 001-008 only when every file matches its baseline", async () => {
    const files = await legacyFiles();
    const applied: AppliedMigration[] = files.map((file) => ({
      name: file.name,
      checksum: null,
    }));

    const plan = createMigrationPlan(files, applied);

    expect(plan.bootstrap).toEqual(
      Object.entries(LEGACY_MIGRATION_BASELINES).map(([name, checksum]) => ({
        name,
        checksum,
      })),
    );
    expect(plan.pending).toEqual([]);

    const changedFiles = files.map((file) =>
      file.name === "004_telegram_roster.sql"
        ? migrationFile(file.name, `${file.sql}\n-- changed`)
        : file,
    );
    expect(() => createMigrationPlan(changedFiles, applied)).toThrow(
      "Legacy migration baseline checksum mismatch: 004_telegram_roster.sql",
    );
  });

  it("does not bootstrap a checksumless non-legacy migration", async () => {
    const files = [
      ...(await legacyFiles()),
      migrationFile("009_example.sql", "SELECT 1;\n"),
    ];

    expect(() =>
      createMigrationPlan(files, [
        { name: "009_example.sql", checksum: null },
      ]),
    ).toThrow(
      "Applied migration has no checksum and is not an approved legacy baseline: 009_example.sql",
    );
  });

  it("accepts verification migration 009 as pending after validating 001-008", async () => {
    const legacy = await legacyFiles();
    const verification = migrationFile(
      "009_verification_attestations.sql",
      await readFile(
        new URL(
          "../../migrations/009_verification_attestations.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const plan = createMigrationPlan(
      [...legacy, verification],
      legacy.map((file) => ({ name: file.name, checksum: file.checksum })),
    );

    expect(plan.bootstrap).toEqual([]);
    expect(plan.pending).toEqual([verification]);
  });

  it("applies SQL and saves its checksum in the same transaction", async () => {
    const client = new FakeClient();
    const file = migrationFile("009_example.sql", "SELECT 1;\n");

    await applyMigration(client, file);

    expect(client.queries).toEqual([
      { text: "BEGIN", values: undefined },
      { text: file.sql, values: undefined },
      {
        text: "INSERT INTO schema_migrations(name, checksum) VALUES ($1, $2)",
        values: [file.name, file.checksum],
      },
      { text: "COMMIT", values: undefined },
    ]);
  });

  it("rolls back SQL when saving the checksum fails", async () => {
    const client = new FakeClient();
    client.failInsert = true;

    await expect(
      applyMigration(client, migrationFile("009_example.sql", "SELECT 1;\n")),
    ).rejects.toThrow("insert failed");
    expect(client.queries.at(-1)?.text).toBe("ROLLBACK");
    expect(client.queries.some((query) => query.text === "COMMIT")).toBe(false);
  });
});
