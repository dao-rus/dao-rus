import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigration, createMigrationPlan, migrationFile } from "./migration-integrity";
import {
  addProfileSignalWithDatabase, archiveProfileSignalWithDatabase, createProfileSignalWithDatabase,
  getProfileAboutWithDatabase, getVisibleProfileAboutWithDatabase, listSignalTypesWithDatabase,
} from "./profile-about";
import {
  consentRelayRevealWithDatabase, createRelayEncounterWithDatabase, getRelayEncounterWithDatabase,
  listExchangeSignalsWithDatabase, sendRelayMessageWithDatabase, listRelayMessagesWithDatabase,
} from "./relay";

const databaseUrl = process.env.SIGNAL_TEST_DATABASE_URL;
const schema = `signal_test_${randomUUID().replaceAll("-", "")}`;
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 12 });
const author = randomUUID(), responder = randomUUID(), outsider = randomUUID();
const directory = new URL("../../migrations/", import.meta.url);
const files = readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()
  .map((name) => migrationFile(name, readFileSync(new URL(name, directory), "utf8")));
const migration = files.find((file) => file.name === "032_exchange_signal_types.sql")!;
let originalSignals: Array<Record<string, unknown>>;
let originalEncounter: string;
let oldBlindNeed: string;
let schemaCreated = false;

async function participant() {
  const id = randomUUID();
  await pool.query("INSERT INTO participants(id, display_name) VALUES ($1, 'Test participant')", [id]);
  return id;
}
async function rewardCount(id: string) {
  return Number((await pool.query("SELECT count(*) FROM darus_ledger WHERE participant_id=$1", [id])).rows[0].count);
}
async function signalRows() {
  return (await pool.query("SELECT * FROM profile_signals ORDER BY id")).rows;
}

async function migrate(file: (typeof files)[number]) {
  const client = await pool.connect();
  try { await applyMigration(client, file); } finally { client.release(); }
}

describe.skipIf(!databaseUrl)("Exchange A1 on real PostgreSQL", () => {
  beforeAll(async () => {
    // Never consume the application's DATABASE_URL or a remote database.
    const url = new URL(databaseUrl!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/signal_tests") {
      throw new Error("Use the isolated local signal_tests database");
    }
    await pool.query(`CREATE SCHEMA ${schema}`);
    schemaCreated = true;
    await pool.query("CREATE TABLE schema_migrations(name text PRIMARY KEY, checksum text NOT NULL)");
    for (const file of files.filter((file) => file.name < migration.name)) await migrate(file);
    await pool.query("INSERT INTO participants(id, display_name) SELECT unnest($1::uuid[]), 'Historical participant'",
      [[author, responder, outsider]]);
    const bodies = ["  Точный текст\nс новой строкой ♥  ", "я".repeat(900), ""];
    // Include all former kinds, states, visibilities and bodies not restricted by the old SQL schema.
    for (const kind of ["need", "have", "want", "can"]) {
      for (const visibility of ["public", "members", "circle", "match_only", "private", "network_blind"]) {
        if (visibility === "network_blind" && kind !== "need" && kind !== "have") continue;
        for (const [index, status] of ["active", "closed", "archived"].entries()) {
          const id = randomUUID();
          await pool.query(`INSERT INTO profile_signals(id,participant_id,kind,body,visibility,status,created_at,updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,'2026-09-01','2026-09-02')`,
          [id, author, kind, bodies[index], visibility, status]);
          if (kind === "need" && visibility === "network_blind" && status === "active") oldBlindNeed = id;
        }
      }
    }
    originalEncounter = await createRelayEncounterWithDatabase(pool, responder, oldBlindNeed);
    originalSignals = await signalRows();
    await migrate(migration);
  }, 60000);

  afterAll(async () => {
    if (schemaCreated) await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  });

  it("preserves every old UUID, byte-for-byte body, lifecycle, visibility, timestamps and Relay link", async () => {
    const rows = await signalRows();
    expect(rows).toHaveLength(originalSignals.length);
    rows.forEach((row, index) => {
      expect(row).toMatchObject(originalSignals[index]);
      expect(row.label).toBe(originalSignals[index].body);
      expect(row.description).toBeNull();
      expect(row.legacy_body).toBe(true);
    });
    expect((await getRelayEncounterWithDatabase(pool, responder, originalEncounter))?.body)
      .toBe(originalSignals.find((row) => row.id === oldBlindNeed)?.body);
    expect((await pool.query("SELECT signal_id FROM relay_encounters WHERE id=$1", [originalEncounter])).rows[0].signal_id)
      .toBe(oldBlindNeed);
  });

  it("seeds ten types and accepts future catalogue entries without SQL or TS enum changes", async () => {
    expect((await listSignalTypesWithDatabase(pool)).map((type) => type.key))
      .toEqual(["can", "dating", "doing", "have", "idea", "know", "need", "search", "skill", "want"]);
    await pool.query("INSERT INTO signal_types(key,display_name) VALUES ('future_type','Будущий тип')");
    const id = await participant();
    const signal = await createProfileSignalWithDatabase(pool, id, {
      kind: "future_type", label: "Налоговое право", description: "Консультации по выходным", visibility: "members",
    });
    expect((await pool.query("SELECT label,description,body,legacy_body FROM profile_signals WHERE id=$1", [signal.id])).rows[0])
      .toEqual({ label: "Налоговое право", description: "Консультации по выходным",
        body: "Налоговое право\n\nКонсультации по выходным", legacy_body: false });
    expect((await getProfileAboutWithDatabase(pool, id))?.signals[0])
      .toMatchObject({ id: signal.id, kind: "future_type", label: "Налоговое право",
        description: "Консультации по выходным", legacyBody: false });
    expect((await listExchangeSignalsWithDatabase(pool, responder, "future_type"))[0].body)
      .toBe("Налоговое право\n\nКонсультации по выходным");
    expect(await rewardCount(id)).toBe(0);
  });

  it("rejects unknown/disabled types in the domain and direct SQL but keeps old records readable and archivable", async () => {
    const id = await participant();
    await pool.query("INSERT INTO signal_types(key,display_name,enabled) VALUES ('disabled','Отключённый',false)");
    for (const kind of ["unknown", "disabled"]) {
      await expect(createProfileSignalWithDatabase(pool, id, { kind, label: "Тест", visibility: "members" }))
        .rejects.toThrow("Unknown or disabled");
      await expect(addProfileSignalWithDatabase(pool, id, kind, "Старый ввод", "members"))
        .rejects.toThrow("Structured content required");
      await expect(pool.query("INSERT INTO profile_signals(participant_id,kind,label) VALUES ($1,$2,'Тест')", [id, kind]))
        .rejects.toMatchObject({ code: "23514" });
    }
    await pool.query("INSERT INTO signal_types(key,display_name) VALUES ('later_disabled','Будет отключён')");
    const signal = await createProfileSignalWithDatabase(pool, id, {
      kind: "later_disabled", label: "Тест", visibility: "members",
    });
    await pool.query("UPDATE signal_types SET enabled=false WHERE key='later_disabled'");
    expect((await getProfileAboutWithDatabase(pool, id))?.signals.map((entry) => entry.id)).toEqual([signal.id]);
    await archiveProfileSignalWithDatabase(pool, id, signal.id);
    expect((await getProfileAboutWithDatabase(pool, id))?.signals).toEqual([]);
    expect(await rewardCount(id)).toBe(0);
  });

  it("enforces brief new labels, optional long descriptions, and a single synchronized content source", async () => {
    const id = await participant();
    const signal = await createProfileSignalWithDatabase(pool, id, {
      kind: "skill", label: "Ремонт автомобилей", description: "Контекст ".repeat(200), visibility: "private",
    });
    await pool.query("UPDATE profile_signals SET label='Автомеханик', description=NULL WHERE id=$1", [signal.id]);
    expect((await pool.query("SELECT label,description,body FROM profile_signals WHERE id=$1", [signal.id])).rows[0])
      .toEqual({ label: "Автомеханик", description: null, body: "Автомеханик" });
    await expect(pool.query("UPDATE profile_signals SET body='Другой текст' WHERE id=$1", [signal.id]))
      .rejects.toMatchObject({ code: "23514" });
    await expect(pool.query(`INSERT INTO profile_signals(participant_id,kind,label,body)
      VALUES ($1,'skill','Краткий текст','Конфликт')`, [id])).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query(`INSERT INTO profile_signals(participant_id,kind,label,legacy_body)
      VALUES ($1,'skill',$2,true)`, [id, "я".repeat(121)])).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query(`INSERT INTO profile_signals(participant_id,kind,label)
      VALUES ($1,'skill',' ')`, [id])).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query(`INSERT INTO profile_signals(participant_id,kind,label,description)
      VALUES ($1,'skill','Тест',$2)`, [id, "я".repeat(10001)])).rejects.toMatchObject({ code: "23514" });
    await expect(pool.query(`INSERT INTO profile_signals(participant_id,kind,body)
      VALUES ($1,'skill','Старый ввод')`, [id])).rejects.toMatchObject({ code: "23514" });
  });

  it("keeps all four legacy writers and converts an explicitly revised legacy label to structured content", async () => {
    const id = await participant();
    for (const kind of ["need", "can", "want", "have"]) {
      await addProfileSignalWithDatabase(pool, id, kind, ` Старый ${kind} `, "members");
    }
    const signals = (await getProfileAboutWithDatabase(pool, id))!.signals;
    expect(signals.map((signal) => signal.kind).sort()).toEqual(["can", "have", "need", "want"]);
    expect(signals.every((signal) => signal.legacyBody && signal.label === signal.body && signal.description === null))
      .toBe(true);
    const can = signals.find((signal) => signal.kind === "can")!;
    await pool.query("UPDATE profile_signals SET body='Новый старый ввод' WHERE id=$1", [can.id]);
    expect((await pool.query("SELECT label,description,body,legacy_body FROM profile_signals WHERE id=$1", [can.id])).rows[0])
      .toEqual({ label: "Новый старый ввод", description: null, body: "Новый старый ввод", legacy_body: true });
    await pool.query("UPDATE profile_signals SET body=$2 WHERE id=$1", [can.id, "я".repeat(500)]);
    await expect(pool.query("UPDATE profile_signals SET kind='skill' WHERE id=$1", [can.id]))
      .rejects.toMatchObject({ code: "23514" });
    await pool.query("UPDATE profile_signals SET label='Ремонт', description='По выходным' WHERE id=$1", [can.id]);
    expect((await pool.query("SELECT label,description,body,legacy_body FROM profile_signals WHERE id=$1", [can.id])).rows[0])
      .toEqual({ label: "Ремонт", description: "По выходным", body: "Ремонт\n\nПо выходным", legacy_body: false });
    await pool.query("UPDATE signal_types SET enabled=false WHERE key='can'");
    try {
      await expect(addProfileSignalWithDatabase(pool, id, "can", "Повтор", "members"))
        .rejects.toThrow("Unknown or disabled");
      await archiveProfileSignalWithDatabase(pool, id, can.id);
    } finally {
      await pool.query("UPDATE signal_types SET enabled=true WHERE key='can'");
    }
  });

  it("keeps /need's body-only contract and exact one-time need/have rewards for both creation paths", async () => {
    const id = await participant();
    const need = await addProfileSignalWithDatabase(pool, id, "need", "я".repeat(500), "network_blind");
    const have = await createProfileSignalWithDatabase(pool, id, { kind: "have", label: "Мастерская", visibility: "private" });
    expect(need?.amount).toBe("0.200000");
    expect(have.reward?.amount).toBe("0.200000");
    expect((await getProfileAboutWithDatabase(pool, id))?.signals.find((entry) => entry.kind === "need"))
      .toMatchObject({ body: "я".repeat(500), label: "я".repeat(500), description: null, legacyBody: true });
    for (const kind of ["need", "have"]) {
      const results = await Promise.all(Array.from({ length: 8 }, () => createProfileSignalWithDatabase(pool, id, {
        kind, label: "Повтор", visibility: "members",
      })));
      expect(results.every((result) => !result.reward)).toBe(true);
    }
    expect(await rewardCount(id)).toBe(2);
    for (const kind of ["search", "can", "want", "know", "skill", "doing", "idea", "dating"]) {
      expect((await createProfileSignalWithDatabase(pool, id, { kind, label: "Тест", visibility: "private" })).reward)
        .toBeUndefined();
    }
    expect(await rewardCount(id)).toBe(2);
    const concurrentId = await participant();
    const rewards = await Promise.all(Array.from({ length: 8 }, (_, index) => index % 2
      ? createProfileSignalWithDatabase(pool, concurrentId, { kind: "need", label: "Тест", visibility: "private" }).then((r) => r.reward)
      : addProfileSignalWithDatabase(pool, concurrentId, "need", "Тест", "private")));
    expect(rewards.filter(Boolean)).toHaveLength(1);
    expect(await rewardCount(concurrentId)).toBe(1);
  });

  it("preserves visibility, active-only reads and archive ownership for structured signals", async () => {
    const id = await participant();
    const created: Array<{ id: string }> = [];
    for (const visibility of ["public", "members", "circle", "match_only", "private", "network_blind"]) {
      created.push(await createProfileSignalWithDatabase(pool, id, { kind: "need", label: visibility, visibility }));
    }
    expect((await getProfileAboutWithDatabase(pool, id))?.signals).toHaveLength(6);
    expect((await getVisibleProfileAboutWithDatabase(pool, id, responder))?.signals.map((signal) => signal.visibility).sort())
      .toEqual(["members", "public"]);
    const exchange = (await listExchangeSignalsWithDatabase(pool, responder, "need"))
      .filter((signal) => created.some((entry) => entry.id === signal.id));
    expect(exchange).toHaveLength(3);
    expect(exchange.find((signal) => signal.anonymous)?.author).toBeNull();
    await archiveProfileSignalWithDatabase(pool, outsider, created[0].id);
    expect((await getProfileAboutWithDatabase(pool, id))?.signals).toHaveLength(6);
    await archiveProfileSignalWithDatabase(pool, id, created[0].id);
    await pool.query("UPDATE profile_signals SET status='closed' WHERE id=$1", [created[1].id]);
    expect((await getProfileAboutWithDatabase(pool, id))?.signals).toHaveLength(4);
    expect((await getVisibleProfileAboutWithDatabase(pool, id, responder))?.signals).toEqual([]);
    expect((await listExchangeSignalsWithDatabase(pool, responder, "need"))
      .filter((signal) => created.some((entry) => entry.id === signal.id))).toHaveLength(1);
  });

  it("keeps Blind Relay need/have-only and reveals identities only after independent mutual consent", async () => {
    const id = await participant();
    for (const kind of ["search", "can", "want", "know", "skill", "doing", "idea", "dating"]) {
      await expect(createProfileSignalWithDatabase(pool, id, { kind, label: "Тест", visibility: "network_blind" }))
        .rejects.toThrow("Invalid visibility");
      await expect(pool.query(`INSERT INTO profile_signals(participant_id,kind,label,visibility)
        VALUES ($1,$2,'Тест','network_blind')`, [id, kind])).rejects.toMatchObject({ code: "23514" });
    }
    for (const kind of ["need", "have"]) {
      const signal = await createProfileSignalWithDatabase(pool, id, {
        kind, label: "Помощь", description: "Без личных данных", visibility: "network_blind",
      });
      await expect(createRelayEncounterWithDatabase(pool, id, signal.id)).rejects.toThrow("unavailable");
      const encounter = await createRelayEncounterWithDatabase(pool, responder, signal.id);
      expect(await getRelayEncounterWithDatabase(pool, outsider, encounter)).toBeNull();
      expect((await getRelayEncounterWithDatabase(pool, responder, encounter))?.other).toBeNull();
      await consentRelayRevealWithDatabase(pool, id, encounter);
      expect((await getRelayEncounterWithDatabase(pool, responder, encounter))?.other).toBeNull();
      await sendRelayMessageWithDatabase(pool, responder, encounter, "Готов помочь");
      expect((await listRelayMessagesWithDatabase(pool, id, encounter))[0].body).toBe("Готов помочь");
      expect(await listRelayMessagesWithDatabase(pool, outsider, encounter)).toEqual([]);
      await consentRelayRevealWithDatabase(pool, responder, encounter);
      expect((await getRelayEncounterWithDatabase(pool, responder, encounter))?.other?.id).toBe(id);
      expect((await getRelayEncounterWithDatabase(pool, id, encounter))?.other?.id).toBe(responder);
      await archiveProfileSignalWithDatabase(pool, id, signal.id);
      await expect(createRelayEncounterWithDatabase(pool, outsider, signal.id)).rejects.toThrow("unavailable");
    }
    const publicSignal = await createProfileSignalWithDatabase(pool, id, { kind: "need", label: "Тест", visibility: "public" });
    await expect(createRelayEncounterWithDatabase(pool, responder, publicSignal.id)).rejects.toThrow("unavailable");
  });

  it("does not reapply a recorded migration; even explicit SQL replay preserves records, types and rewards", async () => {
    const before = await signalRows();
    const ledger = (await pool.query("SELECT * FROM darus_ledger ORDER BY id")).rows;
    await pool.query("UPDATE signal_types SET enabled=false,display_name='Авторское название' WHERE key='dating'");
    const applied = (await pool.query("SELECT name,checksum FROM schema_migrations ORDER BY name")).rows;
    expect(createMigrationPlan(files, applied).pending).toEqual([]);
    await pool.query("BEGIN;" + migration.sql + ";COMMIT;");
    expect(await signalRows()).toEqual(before);
    expect((await pool.query("SELECT * FROM darus_ledger ORDER BY id")).rows).toEqual(ledger);
    expect((await pool.query("SELECT display_name,enabled FROM signal_types WHERE key='dating'")).rows[0])
      .toEqual({ display_name: "Авторское название", enabled: false });
  });
});
