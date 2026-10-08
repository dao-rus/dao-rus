import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigration, migrationFile } from "./migration-integrity";
import { logDepartureWithDatabase } from "./departure-log";
import { parseChannelId, type GuardianSettings } from "./guardian-forum";
import { interfaceTextFields, type InterfaceTextValues } from "./interface-texts";

const databaseUrl = process.env.GUARDIAN_FORUM_TEST_DATABASE_URL;
const schema = `departure_log_test_${randomUUID().replaceAll("-", "")}`;
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 6 });
const directory = new URL("../../migrations/", import.meta.url);
const files = readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()
  .map((name) => migrationFile(name, readFileSync(new URL(name, directory), "utf8")));
const texts = Object.fromEntries(interfaceTextFields.map((field) => [field.key, field.defaultValue])) as InterfaceTextValues;
const settings = (entries: Record<string, string> = { "channel.departures": "-1001234567890" }): GuardianSettings => new Map(Object.entries(entries));
let schemaCreated = false;

async function departed(type: "forum.left" | "forum.removed", name: string, username: string | null, joinedAt: string | null, leftAt = "2026-10-08T04:57:44Z") {
  const id = randomUUID();
  await pool.query("INSERT INTO participants(id, display_name, membership_status) VALUES ($1, $2, 'participant')", [id, name]);
  if (username) {
    const telegramId = String(Math.floor(Math.random() * 1e9));
    await pool.query("INSERT INTO external_identities(participant_id, provider, provider_subject, external_user_id, username) VALUES ($1, 'telegram', $2, $2, $3)", [id, telegramId, username]);
  }
  if (joinedAt) await pool.query("INSERT INTO events(event_type, participant_id, payload, created_at) VALUES ('forum.joined', $1, $2::jsonb, $3)", [id, JSON.stringify({ observed_at: joinedAt }), joinedAt]);
  const event = await pool.query("INSERT INTO events(event_type, participant_id, payload, created_at) VALUES ($1, $2, $3::jsonb, $4) RETURNING id",
    [type, id, JSON.stringify({ observed_at: leftAt }), leftAt]);
  return String(event.rows[0].id);
}
function channel() {
  const sent: string[] = []; let failure: Error | null = null; let next = 500;
  return { sent, fail: (error: Error | null) => { failure = error; },
    send: async (text: string) => { await new Promise((resolve) => setTimeout(resolve, 10)); if (failure) throw failure; sent.push(text); return next++; } };
}

describe("parseChannelId", () => {
  it("takes a channel number or a link to a message in it", () => {
    expect(parseChannelId("-1001234567890")).toBe("-1001234567890");
    expect(parseChannelId(" https://t.me/c/1234567890/17 ")).toBe("-1001234567890");
    for (const bad of ["", "@list_of_exites", "1234567890", "-1234", "https://example.com/c/1234567890/1"]) expect(parseChannelId(bad)).toBeNull();
  });
});

describe.skipIf(!databaseUrl)("Departures channel on real PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/guardian_forum_tests") throw new Error("Use the isolated local guardian_forum_tests database");
    await pool.query(`CREATE SCHEMA ${schema}`); schemaCreated = true;
    await pool.query("CREATE TABLE schema_migrations(name text PRIMARY KEY, checksum text NOT NULL)");
    for (const file of files) { const client = await pool.connect(); try { await applyMigration(client, file); } finally { client.release(); } }
  }, 60000);
  afterAll(async () => { if (schemaCreated) await pool.query(`DROP SCHEMA ${schema} CASCADE`); await pool.end(); });

  it("writes one text line with date, name, username and arrival date, once however often it is asked", async () => {
    const id = await departed("forum.left", "Tony Vershinin", "Tony1C2023", "2024-01-13T09:00:00Z");
    const bot = channel(), deps = { database: pool, send: bot.send, settings: settings(), texts };
    const results = await Promise.all([1, 2, 3, 4].map(() => logDepartureWithDatabase(deps, id)));
    expect(results.filter((result) => result === "logged")).toHaveLength(1);
    expect(bot.sent).toEqual(["08.10.2026 · Tony Vershinin · @Tony1C2023 · В ДАО с 13 января 2024 г. · Покинул форум"]);
    expect(await logDepartureWithDatabase(deps, id)).toBe("none");
    expect((await pool.query("SELECT message_id FROM departure_log_posts WHERE event_id = $1", [id])).rows[0].message_id).toBe("500");
  });

  it("leaves out the arrival date when it is unknown", async () => {
    const id = await departed("forum.left", "Без даты", null, null);
    const bot = channel();
    await logDepartureWithDatabase({ database: pool, send: bot.send, settings: settings(), texts }, id);
    expect(bot.sent).toEqual(["08.10.2026 · Без даты · Покинул форум"]);
  });

  it("does not write removals, nor when the switch or the channel is off", async () => {
    const removed = await departed("forum.removed", "Удалённый", null, null), left = await departed("forum.left", "Вышедший", null, null);
    const bot = channel();
    expect(await logDepartureWithDatabase({ database: pool, send: bot.send, settings: settings(), texts }, removed)).toBe("none");
    expect(await logDepartureWithDatabase({ database: pool, send: bot.send, settings: settings({ "channel.departures": "-1001234567890", "feature.departure_log": "off" }), texts }, left)).toBe("none");
    expect(await logDepartureWithDatabase({ database: pool, send: bot.send, settings: settings({}), texts }, left)).toBe("none");
    expect(bot.sent).toEqual([]);
  });

  it("lets a failed write be repeated and does not write departures that predate the channel log", async () => {
    const id = await departed("forum.left", "Повтор", null, null), bot = channel();
    const deps = { database: pool, send: bot.send, settings: settings(), texts };
    bot.fail(new Error("telegram down"));
    await expect(logDepartureWithDatabase(deps, id)).rejects.toThrow("telegram down");
    bot.fail(null);
    expect(await logDepartureWithDatabase(deps, id)).toBe("logged");
    expect(bot.sent).toHaveLength(1);
  });
});
