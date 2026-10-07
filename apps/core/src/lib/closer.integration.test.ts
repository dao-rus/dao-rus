import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigration, migrationFile } from "./migration-integrity";
import {
  CloserUnavailableError, listCloserCounterpartIdsWithDatabase, listCloserGoalsWithDatabase, listCloserMatchesWithDatabase,
  listOwnCloserKeysWithDatabase, openCloserDialogWithDatabase, saveCloserGoalsWithDatabase, setCloserKeysWithDatabase,
  type CloserKeys,
} from "./closer";
import {
  cancelRelayEncounterWithDatabase, consentRelayRevealWithDatabase, getRelayEncounterWithDatabase,
} from "./relay";
import {
  archiveSignalWithDatabase, createSignalWithDatabase, getGuestShareableSignalWithDatabase, getSignalWithDatabase,
  listNetworkSignalsWithDatabase, listParticipantSignalsWithDatabase, searchNetworkSignalsWithDatabase, updateSignalWithDatabase,
} from "./signals";

const databaseUrl = process.env.CLOSER_TEST_DATABASE_URL;
const schema = `closer_test_${randomUUID().replaceAll("-", "")}`;
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 12 });
const directory = new URL("../../migrations/", import.meta.url);
const files = readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()
  .map((name) => migrationFile(name, readFileSync(new URL(name, directory), "utf8")));
let schemaCreated = false;

async function participant(city?: string, name = "Тайный Участник") {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO participants(id, display_name, residence_name, residence_type, residence_country)
     VALUES ($1, $2, $3, $4, $5)`, [id, name, city ?? null, city ? "city" : null, city ? "Россия" : null]);
  return id;
}
// Every test gets its own goal, so records of other tests can never match its records.
async function goal(asksGender = false) {
  const key = `g_${randomUUID().replaceAll("-", "")}`;
  await pool.query("INSERT INTO closer_goals(key, display_name, asks_gender) VALUES ($1, 'Цель теста', $2)", [key, asksGender]);
  return key;
}
const keys = (goalKey: string, over: Partial<CloserKeys> = {}): CloserKeys =>
  ({ goalKey, anyCity: false, selfGender: null, seeksGender: null, ...over });
async function record(owner: string, k: CloserKeys | null, label = "Скрытая запись", visibility = "match_only") {
  const { signal } = await createSignalWithDatabase(pool, owner, { typeKey: "dating", label, description: "Подробности", visibility });
  if (k) await setCloserKeysWithDatabase(pool, owner, signal.id, k);
  return signal.id;
}
const matchIds = async (viewer: string) => (await listCloserMatchesWithDatabase(pool, viewer)).map((match) => match.signalId).sort();

describe.skipIf(!databaseUrl)("Closer matching on real PostgreSQL", () => {
  beforeAll(async () => {
    // Never consume the application's DATABASE_URL or a remote database.
    const url = new URL(databaseUrl!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/closer_tests") throw new Error("Use the isolated local closer_tests database");
    await pool.query(`CREATE SCHEMA ${schema}`);
    schemaCreated = true;
    await pool.query("CREATE TABLE schema_migrations(name text PRIMARY KEY, checksum text NOT NULL)");
    for (const file of files) {
      const client = await pool.connect();
      try { await applyMigration(client, file); } finally { client.release(); }
    }
  }, 60000);
  afterAll(async () => {
    if (schemaCreated) await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  });

  it("seeds the five initial goals, two of which ask for gender", async () => {
    const goals = (await listCloserGoalsWithDatabase(pool)).filter((entry) => !entry.key.startsWith("g_"));
    expect(goals.map((entry) => entry.key)).toEqual(["friend", "relationship", "family", "support", "likeminded"]);
    expect(goals.filter((entry) => entry.asksGender).map((entry) => entry.key)).toEqual(["relationship", "family"]);
  });

  it("matches the same goal when cities are equal or either side does not care, symmetrically", async () => {
    const g = await goal(), other = await goal();
    const [moscowA, moscowB, kazan, anywhere, elsewhere, homeless] = await Promise.all([
      participant("Москва"), participant("москва"), participant("Казань"), participant("Казань"), participant("Москва"), participant()]);
    const a = await record(moscowA, keys(g)), b = await record(moscowB, keys(g)), c = await record(kazan, keys(g));
    const d = await record(anywhere, keys(g, { anyCity: true }));
    await record(elsewhere, keys(other));
    // "My city" without a residence in the profile matches only someone who does not care.
    const h = await record(homeless, keys(g));
    expect(await matchIds(moscowA)).toEqual([b, d].sort());
    expect(await matchIds(moscowB)).toEqual([a, d].sort());
    expect(await matchIds(kazan)).toEqual([d]);
    expect(await matchIds(anywhere)).toEqual([a, b, c, h].sort());
    expect(await matchIds(homeless)).toEqual([d]);
    expect(await matchIds(elsewhere)).toEqual([]);
  });

  it("requires mutual gender compatibility only for goals that ask for it", async () => {
    const g = await goal(true);
    const [man, woman, womanSeekingWoman, unstated, openWoman] = await Promise.all(Array.from({ length: 5 }, () => participant("Тверь")));
    await record(man, keys(g, { selfGender: "m", seeksGender: "f" }));
    const w = await record(woman, keys(g, { selfGender: "f", seeksGender: "m" }));
    await record(womanSeekingWoman, keys(g, { selfGender: "f", seeksGender: "f" }));
    await record(unstated, keys(g, { selfGender: null, seeksGender: "any" }));
    const o = await record(openWoman, keys(g, { selfGender: "f", seeksGender: "any" }));
    expect(await matchIds(man)).toEqual([w, o].sort());
    // Someone who did not state their own gender is offered only to those who do not care.
    expect(await matchIds(unstated)).toEqual([o]);
    expect((await matchIds(womanSeekingWoman))).toEqual([o]);
  });

  it("exposes a match without any identity, and never through the ordinary reads", async () => {
    const g = await goal();
    const viewer = await participant("Псков", "Зритель Зрителев"), hidden = await participant("Псков", "Надежда Скрытая");
    const mine = await record(viewer, keys(g)), theirs = await record(hidden, keys(g), "Ищу близкого друга");
    const matches = await listCloserMatchesWithDatabase(pool, viewer);
    expect(matches).toEqual([{ mySignalId: mine, signalId: theirs, goalName: "Цель теста", city: "Псков",
      label: "Ищу близкого друга", description: "Подробности", encounterId: null }]);
    const serialized = JSON.stringify(matches);
    expect(serialized).not.toContain(hidden);
    expect(serialized).not.toContain("Надежда");
    // The record stays unreachable by URL, listing, profile, guest card and Angel search.
    expect(await getSignalWithDatabase(pool, viewer, theirs)).toBeNull();
    expect(await getGuestShareableSignalWithDatabase(pool, theirs)).toBeNull();
    expect(await listNetworkSignalsWithDatabase(pool, viewer, "dating")).toEqual([]);
    expect(await listParticipantSignalsWithDatabase(pool, hidden, viewer)).toEqual([]);
    expect(await searchNetworkSignalsWithDatabase(pool, viewer, { typeKeys: [], terms: ["близкого"] })).toEqual([]);
    expect([...(await listOwnCloserKeysWithDatabase(pool, viewer)).keys()]).toEqual([mine]);
    expect(await listCloserCounterpartIdsWithDatabase(pool, hidden, mine)).toEqual([]);
  });

  it("does not match drafts, archived records, records without keys, disabled goals or one's own records", async () => {
    const g = await goal();
    const viewer = await participant("Орёл");
    const mine = await record(viewer, keys(g));
    await record(viewer, keys(g), "Вторая своя");
    const others = await Promise.all(Array.from({ length: 4 }, () => participant("Орёл")));
    await record(others[0], keys(g), "Черновик", "private");
    await record(others[1], null, "Без ключей");
    const archived = await record(others[2], keys(g));
    await archiveSignalWithDatabase(pool, others[2], archived);
    const live = await record(others[3], keys(g));
    expect(await matchIds(viewer)).toEqual([live]);
    await pool.query("UPDATE closer_goals SET enabled = false WHERE key = $1", [g]);
    expect(await matchIds(viewer)).toEqual([]);
    await expect(setCloserKeysWithDatabase(pool, viewer, mine, keys(g))).rejects.toThrow("Unknown or disabled closer goal");
  });

  it("reports only owners whose match is new, and only to the author's own records", async () => {
    const g = await goal(), away = await goal();
    const first = await participant("Тула"), second = await participant("Тула");
    await record(first, keys(g));
    const { signal } = await createSignalWithDatabase(pool, second, { typeKey: "dating", label: "Запись", visibility: "match_only" });
    expect(await setCloserKeysWithDatabase(pool, second, signal.id, keys(g))).toEqual([first]);
    expect(await setCloserKeysWithDatabase(pool, second, signal.id, keys(g))).toEqual([]);
    expect(await setCloserKeysWithDatabase(pool, second, signal.id, keys(away))).toEqual([]);
    // A draft that becomes matchable: the caller's snapshot from before the edit decides what is new.
    await updateSignalWithDatabase(pool, second, signal.id, { label: "Запись", visibility: "private" });
    await setCloserKeysWithDatabase(pool, second, signal.id, keys(g));
    const before = await listCloserCounterpartIdsWithDatabase(pool, second, signal.id);
    expect(before).toEqual([]);
    await updateSignalWithDatabase(pool, second, signal.id, { label: "Запись", visibility: "match_only" });
    expect(await setCloserKeysWithDatabase(pool, second, signal.id, keys(g), before)).toEqual([first]);
    await expect(setCloserKeysWithDatabase(pool, first, signal.id, keys(g))).rejects.toThrow("Signal unavailable");
    const events = await pool.query("SELECT payload FROM events WHERE event_type = 'participant.closer_keys_set' AND participant_id = $1", [second]);
    expect(Object.keys(events.rows[0].payload).sort()).toEqual(["goal_key", "signal_id"]);
  });

  it("limits a participant to three active records, also under concurrent inserts", async () => {
    const owner = await participant();
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, index) =>
      createSignalWithDatabase(pool, owner, { typeKey: "dating", label: `Запись ${index}`, visibility: "match_only" })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
    for (const result of results) if (result.status === "rejected") expect(result.reason).toMatchObject({ code: "23514" });
    const ids = (await listParticipantSignalsWithDatabase(pool, owner, owner)).map((signal) => signal.id);
    await archiveSignalWithDatabase(pool, owner, ids[0]);
    await createSignalWithDatabase(pool, owner, { typeKey: "dating", label: "После архива", visibility: "private" });
    // Other types are not limited.
    for (let index = 0; index < 5; index++) await createSignalWithDatabase(pool, owner, { typeKey: "need", label: `Нужно ${index}`, visibility: "members" });
  });

  it("accepts keys only for dating records", async () => {
    const owner = await participant();
    const { signal } = await createSignalWithDatabase(pool, owner, { typeKey: "need", label: "Фотограф", visibility: "members" });
    await expect(setCloserKeysWithDatabase(pool, owner, signal.id, keys("friend"))).rejects.toThrow("Signal unavailable");
    await expect(pool.query("INSERT INTO signal_closer_keys(signal_id, goal_key, any_city) VALUES ($1, 'friend', true)", [signal.id]))
      .rejects.toMatchObject({ code: "23514" });
  });

  it("opens one anonymous dialog per match, keeps identities hidden until mutual consent, and retires a cancelled pair", async () => {
    const g = await goal();
    const anna = await participant("Курск", "Анна Первая"), boris = await participant("Курск", "Борис Второй"), outsider = await participant("Курск");
    const a = await record(anna, keys(g)), b = await record(boris, keys(g));
    // Not a party to the match, a foreign "own" record, an unmatched pair and malformed IDs are all refused alike.
    await expect(openCloserDialogWithDatabase(pool, outsider, a, b)).rejects.toBeInstanceOf(CloserUnavailableError);
    await expect(openCloserDialogWithDatabase(pool, anna, b, a)).rejects.toBeInstanceOf(CloserUnavailableError);
    await expect(openCloserDialogWithDatabase(pool, anna, a, a)).rejects.toBeInstanceOf(CloserUnavailableError);
    await expect(openCloserDialogWithDatabase(pool, anna, a, "x")).rejects.toBeInstanceOf(CloserUnavailableError);

    const [one, two] = await Promise.all([openCloserDialogWithDatabase(pool, anna, a, b), openCloserDialogWithDatabase(pool, boris, b, a)]);
    expect(one.encounterId).toBe(two.encounterId);
    expect([one.notifyParticipantId, two.notifyParticipantId].filter(Boolean)).toHaveLength(1);
    expect((await openCloserDialogWithDatabase(pool, anna, a, b))).toEqual({ encounterId: one.encounterId, notifyParticipantId: null });
    expect((await pool.query("SELECT count(*)::int AS n FROM relay_encounters WHERE signal_id IN ($1, $2)", [a, b])).rows[0].n).toBe(1);
    expect((await listCloserMatchesWithDatabase(pool, anna))[0].encounterId).toBe(one.encounterId);
    expect((await listCloserMatchesWithDatabase(pool, boris))[0].encounterId).toBe(one.encounterId);

    for (const viewer of [anna, boris]) expect((await getRelayEncounterWithDatabase(pool, viewer, one.encounterId))?.other).toBeNull();
    expect(await getRelayEncounterWithDatabase(pool, outsider, one.encounterId)).toBeNull();
    await consentRelayRevealWithDatabase(pool, anna, one.encounterId);
    expect((await getRelayEncounterWithDatabase(pool, boris, one.encounterId))?.other).toBeNull();
    await consentRelayRevealWithDatabase(pool, boris, one.encounterId);
    expect((await getRelayEncounterWithDatabase(pool, boris, one.encounterId))?.other).toMatchObject({ id: anna, name: "Анна Первая" });

    await cancelRelayEncounterWithDatabase(pool, boris, one.encounterId);
    expect(await matchIds(anna)).toEqual([]);
    expect(await matchIds(boris)).toEqual([]);
    await expect(openCloserDialogWithDatabase(pool, anna, a, b)).rejects.toBeInstanceOf(CloserUnavailableError);
  });

  it("lets an administrator rename, disable and add goals without deleting any", async () => {
    const admin = await participant(), g = await goal();
    const current = (await listCloserGoalsWithDatabase(pool)).map((entry) => ({ ...entry }));
    const unchanged = current.map((entry) => ({ key: entry.key, displayName: entry.displayName, asksGender: entry.asksGender, enabled: entry.enabled }));
    expect(await saveCloserGoalsWithDatabase(pool, admin, unchanged)).toBe(false);
    const fresh = `travel_${randomUUID().slice(0, 8)}`;
    expect(await saveCloserGoalsWithDatabase(pool, admin,
      unchanged.map((entry) => entry.key === g ? { ...entry, displayName: "  Новое имя ", enabled: false, asksGender: true } : entry),
      { key: fresh, displayName: "Попутчик", asksGender: false })).toBe(true);
    const after = await listCloserGoalsWithDatabase(pool);
    expect(after).toHaveLength(current.length + 1);
    expect(after.find((entry) => entry.key === g)).toEqual({ key: g, displayName: "Новое имя", asksGender: true, enabled: false });
    expect(after.at(-1)).toEqual({ key: fresh, displayName: "Попутчик", asksGender: false, enabled: true });
    await expect(saveCloserGoalsWithDatabase(pool, admin, [], { key: fresh, displayName: "Дубль", asksGender: false })).rejects.toThrow("already exists");
    await expect(saveCloserGoalsWithDatabase(pool, admin, [], { key: "Bad Key", displayName: "Имя", asksGender: false })).rejects.toThrow("Invalid closer goal key");
    await expect(saveCloserGoalsWithDatabase(pool, admin, [{ ...unchanged[0], displayName: " " }])).rejects.toThrow();
    const events = await pool.query("SELECT payload FROM events WHERE event_type = 'closer.goals_updated' AND participant_id = $1", [admin]);
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0].payload.keys.sort()).toEqual([g, fresh].sort());
  });
});
