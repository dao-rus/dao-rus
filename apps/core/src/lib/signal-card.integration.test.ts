import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigration, migrationFile } from "./migration-integrity";
import { markRewardShownWithDatabase, readPendingRewardWithDatabase } from "./reward-announcements";
import { readSignalReactionStateWithDatabase, setSignalReactionWithDatabase } from "./signal-reactions";
import { archiveSignalWithDatabase, countSignalViewWithDatabase, createSignalWithDatabase, getGuestShareableSignalWithDatabase,
  getSignalWithDatabase, isSignalHiddenWithDatabase, listHiddenSignalsWithDatabase, listNetworkSignalsWithDatabase,
  readSignalViewsWithDatabase, searchNetworkSignalsWithDatabase, setSignalHiddenWithDatabase, updateSignalWithDatabase } from "./signals";

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

  async function person(name = "Участник") {
    const id = randomUUID();
    await pool.query("INSERT INTO participants(id,display_name) VALUES ($1,$2)", [id, name]);
    return id;
  }
  const make = async (author: string, label: string, visibility = "members", typeKey = "idea") =>
    (await createSignalWithDatabase(pool, author, { typeKey, label, visibility })).signal.id;

  it("orders Top by active likes and New by date, without changing who can see what", async () => {
    const author = await person(), [a, b, c] = await Promise.all([person(), person(), person()]);
    const type = "doing";
    const old = await make(author, "Старая с двумя лайками", "members", type);
    const mid = await make(author, "Средняя с одним", "public", type);
    const fresh = await make(author, "Свежая без лайков", "members", type);
    await pool.query("UPDATE profile_signals SET created_at = now() - interval '3 days' WHERE id=$1", [old]);
    await pool.query("UPDATE profile_signals SET created_at = now() - interval '2 days' WHERE id=$1", [mid]);
    const priv = await make(author, "Закрытая", "private", type);
    for (const fan of [a, b]) await setSignalReactionWithDatabase(pool, fan, old, true);
    await setSignalReactionWithDatabase(pool, c, mid, true);
    const ids = async (sort?: "new" | "top") => (await listNetworkSignalsWithDatabase(pool, a, type, sort))
      .map((signal) => signal.id).filter((id) => [old, mid, fresh, priv].includes(id));
    expect(await ids()).toEqual([fresh, mid, old]);
    expect(await ids("new")).toEqual([fresh, mid, old]);
    expect(await ids("top")).toEqual([old, mid, fresh]);
    // A revoked like stops counting.
    for (const fan of [a, b]) await setSignalReactionWithDatabase(pool, fan, old, false);
    expect(await ids("top")).toEqual([mid, fresh, old]);
  });

  it("hides a record only for the participant who hid it, and never one's own or an unreachable one", async () => {
    const author = await person("Автор Скрываемый"), me = await person(), other = await person();
    const shown = await make(author, "Обычная запись о рыбалке"), secret = await make(author, "Закрытая", "private");
    const mine = await make(me, "Моя запись");
    expect(await setSignalHiddenWithDatabase(pool, me, mine, true)).toBeNull();
    expect(await setSignalHiddenWithDatabase(pool, me, secret, true)).toBeNull();
    expect(await setSignalHiddenWithDatabase(pool, me, "not-a-uuid", true)).toBeNull();
    expect((await pool.query("SELECT count(*)::int AS n FROM signal_hides WHERE participant_id=$1", [me])).rows[0].n).toBe(0);

    expect((await setSignalHiddenWithDatabase(pool, me, shown, true))?.id).toBe(shown);
    await setSignalHiddenWithDatabase(pool, me, shown, true);
    expect(await isSignalHiddenWithDatabase(pool, me, shown)).toBe(true);
    const listed = async (viewer: string) => (await listNetworkSignalsWithDatabase(pool, viewer, "idea")).some((signal) => signal.id === shown);
    expect(await listed(me)).toBe(false);
    expect(await listed(other)).toBe(true);
    expect(await searchNetworkSignalsWithDatabase(pool, me, { typeKeys: [], terms: ["рыбалке"] })).toEqual([]);
    expect(await searchNetworkSignalsWithDatabase(pool, other, { typeKeys: [], terms: ["рыбалке"] })).toHaveLength(1);
    // Still reachable by its address, and nothing about the hide reaches the author or the counters.
    expect((await getSignalWithDatabase(pool, me, shown))?.id).toBe(shown);
    expect((await readSignalReactionStateWithDatabase(pool, shown, author)).count).toBe(0);
    expect((await listHiddenSignalsWithDatabase(pool, me)).map((signal) => signal.id)).toEqual([shown]);
    expect(await listHiddenSignalsWithDatabase(pool, other)).toEqual([]);
    expect((await pool.query("SELECT count(*)::int AS n FROM events WHERE payload->>'signal_id' = $1 AND event_type LIKE '%hid%'", [shown])).rows[0].n).toBe(0);

    // A record withdrawn by its author leaves the hidden list, and can still be un-hidden.
    await archiveSignalWithDatabase(pool, author, shown);
    expect(await listHiddenSignalsWithDatabase(pool, me)).toEqual([]);
    await setSignalHiddenWithDatabase(pool, me, shown, false);
    expect(await isSignalHiddenWithDatabase(pool, me, shown)).toBe(false);
  });

  it("counts views as a plain number: not the author's own, and only where the record can be opened", async () => {
    const author = await person(), member = await person();
    const open = await make(author, "Публичная", "public"), inner = await make(author, "Для участников");
    const blind = await make(author, "Анонимная", "network_blind", "need"), secret = await make(author, "Закрытая", "private");
    expect(await countSignalViewWithDatabase(pool, author, open)).toBe(false);
    expect(await readSignalViewsWithDatabase(pool, open)).toBe(0);
    await Promise.all(Array.from({ length: 20 }, (_, index) => countSignalViewWithDatabase(pool, index % 2 ? member : null, open)));
    expect(await readSignalViewsWithDatabase(pool, open)).toBe(20);
    expect(await countSignalViewWithDatabase(pool, member, inner)).toBe(true);
    expect(await countSignalViewWithDatabase(pool, member, blind)).toBe(true);
    // Guests can only add to a publicly readable record; nobody can to a private or missing one.
    for (const [who, id] of [[null, inner], [null, blind], [member, secret], [null, secret], [member, randomUUID()], [member, "x"]] as const) {
      expect(await countSignalViewWithDatabase(pool, who, id)).toBe(false);
    }
    expect([await readSignalViewsWithDatabase(pool, inner), await readSignalViewsWithDatabase(pool, blind), await readSignalViewsWithDatabase(pool, secret)])
      .toEqual([1, 1, 0]);
    await archiveSignalWithDatabase(pool, author, open);
    expect(await countSignalViewWithDatabase(pool, member, open)).toBe(false);
    // Nothing identifies a viewer: the table holds a record reference and a number.
    const columns = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'signal_view_counts' ORDER BY 1", [schema]);
    expect(columns.rows.map((row) => row.column_name)).toEqual(["signal_id", "views"]);
  });
  it("shows a reward that came while the author was away once, and only to its owner", async () => {
    const author = await person(), friend = await person();
    const need = await make(author, "Нужен попутчик", "members", "need");
    expect(await readPendingRewardWithDatabase(pool, author)).toBeNull();
    await setSignalReactionWithDatabase(pool, friend, need, true);
    const pending = await readPendingRewardWithDatabase(pool, author);
    expect(pending?.amount).toBe("0,2");
    expect(await readPendingRewardWithDatabase(pool, friend)).toBeNull();
    // Nobody else can use it up, and a made-up or malformed id does nothing.
    expect(await markRewardShownWithDatabase(pool, friend, pending!.id)).toBe(false);
    expect(await markRewardShownWithDatabase(pool, author, randomUUID())).toBe(false);
    expect(await markRewardShownWithDatabase(pool, author, "x")).toBe(false);
    expect(await readPendingRewardWithDatabase(pool, author)).toEqual(pending);
    expect(await markRewardShownWithDatabase(pool, author, pending!.id)).toBe(true);
    expect(await markRewardShownWithDatabase(pool, author, pending!.id)).toBe(false);
    expect(await readPendingRewardWithDatabase(pool, author)).toBeNull();
    // Showing it never touches the ledger itself.
    expect((await pool.query("SELECT count(*)::int AS n FROM darus_ledger WHERE participant_id=$1", [author])).rows[0].n).toBe(1);
  });

  it("finds records by word stem and by any of the words, best match first, within the same visibility", async () => {
    const author = await person(), reader = await person();
    const both = await make(author, "Юрист по земельным вопросам, Тверь", "members", "skill");
    const one = await make(author, "Ищу хорошего юриста", "members", "need");
    const secret = await make(author, "Личный юрист", "private", "skill");
    const blind = await make(author, "Юристы нужны", "match_only", "need");
    const ids = async (terms: string[], typeKeys: string[] = []) =>
      (await searchNetworkSignalsWithDatabase(pool, reader, { typeKeys, terms })).map((signal) => signal.id)
        .filter((id) => [both, one, secret, blind].includes(id));
    expect(await ids(["юриста"])).toEqual([one, both]);
    expect(await ids(["юристу", "вопросы"])).toEqual([both, one]);
    expect(await ids(["юрист", "Самара"])).toEqual([one, both]);
    // A type named by the interpreter raises matching records but excludes none.
    expect(await ids(["юрист"], ["skill"])).toEqual([both, one]);
    expect(await ids(["трактор"])).toEqual([]);
    expect(await ids(["100%"])).toEqual([]);
  });
});
