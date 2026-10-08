import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigration, migrationFile } from "./migration-integrity";
import { importIntroductions, parseIntroductionEntries, IntroductionImportValidationError } from "./introduction-import";
import { getOnboardingQuestsWithDatabase } from "./onboarding-quests";
import { addProfileInterestWithDatabase, removeProfileInterestWithDatabase, saveProfileWithDatabase } from "./profile-about";

const databaseUrl = process.env.GUARDIAN_FORUM_TEST_DATABASE_URL;
const schema = `introduction_import_test_${randomUUID().replaceAll("-", "")}`;
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 4 });
const directory = new URL("../../migrations/", import.meta.url);
const files = readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()
  .map((name) => migrationFile(name, readFileSync(new URL(name, directory), "utf8")));
const texts = { both: "Город: {city}. Интересы: {interests}.", city: "Город: {city}.", interests: "Интересы: {interests}.", action: "Открыть профиль" };
let schemaCreated = false, nextTelegramId = 700000;

async function person(status = "none") {
  const id = randomUUID(), telegram = String(nextTelegramId++);
  await pool.query("INSERT INTO participants(id, display_name, membership_status) VALUES ($1, 'Участник форума', $2)", [id, status]);
  await pool.query("INSERT INTO external_identities(participant_id, provider, provider_subject, external_user_id) VALUES ($1, 'telegram', $2, $3)",
    [id, `roster:${telegram}`, telegram]);
  return { id, telegram };
}
const entry = (telegram: string, city: string | null, interests: string[] = []) => parseIntroductionEntries([{ telegram_user_id: telegram,
  residence: city ? { name: city, type: "город", country: "Россия" } : null, interests }])[0];
const count = async (sql: string, id: string) => Number((await pool.query(sql, [id])).rows[0].count);
const rewards = (id: string) => count("SELECT count(*) FROM darus_ledger WHERE participant_id = $1", id);
const profile = async (id: string) => ({
  city: (await pool.query("SELECT residence_name FROM participants WHERE id = $1", [id])).rows[0].residence_name as string | null,
  interests: (await pool.query("SELECT label FROM participant_interests WHERE participant_id = $1 ORDER BY label", [id])).rows.map((row) => String(row.label)),
});

describe.skipIf(!databaseUrl)("introduction import on real PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/guardian_forum_tests") throw new Error("Use the isolated local guardian_forum_tests database");
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

  it("a dry run counts and writes nothing", async () => {
    const one = await person();
    const result = await importIntroductions(pool, [entry(one.telegram, "Тамбов", ["IT"]), entry("999999999", "Москва")], texts, false);
    expect(result).toMatchObject({ entries: 2, unknown: 1, participants: 1, residences: 1, interestOwners: 1, interests: 1 });
    expect(await profile(one.id)).toEqual({ city: null, interests: [] });
    expect(await count("SELECT count(*) FROM notifications WHERE participant_id = $1", one.id)).toBe(0);
    expect(await count("SELECT count(*) FROM onboarding_quest_completions WHERE participant_id = $1", one.id)).toBe(0);
  });

  it("fills an empty profile, tells the person, mints nothing and leaves no reward for later", async () => {
    const one = await person();
    await importIntroductions(pool, [entry(one.telegram, "Тамбов", ["IT", "История"])], texts, true);
    expect(await profile(one.id)).toEqual({ city: "Тамбов", interests: ["IT", "История"] });
    expect(await rewards(one.id)).toBe(0);
    expect(await count("SELECT count(*) FROM events WHERE participant_id = $1 AND event_type = 'onboarding.quest_completed'", one.id)).toBe(0);
    const notice = await pool.query(`SELECT n.text, n.action_url, n.action_label, d.status FROM notifications n
      JOIN notification_deliveries d ON d.notification_id = n.id WHERE n.participant_id = $1`, [one.id]);
    expect(notice.rows).toEqual([{ text: "Город: Тамбов. Интересы: IT, История.", action_url: "/profile", action_label: "Открыть профиль", status: "pending" }]);
    // The person's own later edits of the same fields earn nothing: the first action is closed.
    const quests = (await getOnboardingQuestsWithDatabase(pool, one.id)).map((quest) => quest.sourceType);
    expect(quests).toEqual(["need_first_created", "have_first_created"]);
    expect((await saveProfileWithDatabase(pool, one.id, "Имя", "", "members", { name: "Москва", type: "город", country: "Россия" })).reward).toBeUndefined();
    expect(await addProfileInterestWithDatabase(pool, one.id, "Пчеловодство", "members")).toBeUndefined();
    expect(await rewards(one.id)).toBe(0);
  });

  it("never touches what the person filled in, and keeps the reward they earned", async () => {
    const one = await person();
    await saveProfileWithDatabase(pool, one.id, "Имя", "", "members", { name: "Казань", type: "город", country: "Россия" });
    expect(await rewards(one.id)).toBe(1);
    const result = await importIntroductions(pool, [entry(one.telegram, "Москва", ["История"])], texts, true);
    expect(result).toMatchObject({ participants: 1, residences: 0, residencesKept: 1, interestOwners: 1 });
    expect(await profile(one.id)).toEqual({ city: "Казань", interests: ["История"] });
    expect((await pool.query("SELECT text FROM notifications WHERE participant_id = $1", [one.id])).rows[0].text).toBe("Интересы: История.");
    expect(await rewards(one.id)).toBe(1);

    const two = await person();
    await addProfileInterestWithDatabase(pool, two.id, "Свой интерес", "members");
    const kept = await importIntroductions(pool, [entry(two.telegram, null, ["История"])], texts, true);
    expect(kept).toMatchObject({ participants: 0, nothingToWrite: 1, interestsKept: 1 });
    expect(await profile(two.id)).toEqual({ city: null, interests: ["Свой интерес"] });
    expect(await count("SELECT count(*) FROM notifications WHERE participant_id = $1", two.id)).toBe(0);
  });

  it("a repeated run does not bring back what the person removed, nor notify twice", async () => {
    const one = await person();
    const entries = [entry(one.telegram, "Пенза", ["История"])];
    await importIntroductions(pool, entries, texts, true);
    const interest = await pool.query("SELECT id FROM participant_interests WHERE participant_id = $1", [one.id]);
    await removeProfileInterestWithDatabase(pool, one.id, String(interest.rows[0].id));
    await saveProfileWithDatabase(pool, one.id, "Имя", "", "members", { name: "", type: "", country: "" });
    expect(await importIntroductions(pool, entries, texts, true)).toMatchObject({ alreadyImported: 1, participants: 0 });
    expect(await profile(one.id)).toEqual({ city: null, interests: [] });
    expect(await count("SELECT count(*) FROM notifications WHERE participant_id = $1", one.id)).toBe(1);
  });

  it("skips people who left and unknown Telegram users", async () => {
    const gone = await person("left");
    const result = await importIntroductions(pool, [entry(gone.telegram, "Москва"), entry("888888888", "Москва")], texts, true);
    expect(result).toMatchObject({ departed: 1, unknown: 1, participants: 0 });
    expect(await profile(gone.id)).toEqual({ city: null, interests: [] });
  });

  it("a forum join names the placeholder profile, but never overrides login data or a chosen name", async () => {
    process.env.TELEGRAM_FORUM_CHAT_ID = "-1001725482832";
    const { observeForumMemberUpdate } = await import("./telegram-forum-onboarding");
    let updateId = 5000;
    const join = (telegram: number, user: object) => observeForumMemberUpdate({ update_id: updateId++, chat_member: {
      chat: { id: -1001725482832 }, date: 1790858400 + updateId, old_chat_member: { status: "left" },
      new_chat_member: { status: "member", user: { id: telegram, ...user } } } }, pool);
    const shown = async (telegram: number) => (await pool.query(
      `SELECT p.display_name, e.username, e.first_name, e.last_name FROM external_identities e JOIN participants p ON p.id = e.participant_id
        WHERE e.external_user_id = $1`, [String(telegram)])).rows[0];
    await join(910001, { first_name: "Анна", last_name: "Иванова", username: "anna_i" });
    expect(await shown(910001)).toEqual({ display_name: "Анна Иванова", username: "anna_i", first_name: "Анна", last_name: "Иванова" });
    await join(910002, { first_name: "Борис" });
    expect(await shown(910002)).toEqual({ display_name: "Борис", username: null, first_name: "Борис", last_name: null });

    const known = await person();
    await pool.query("UPDATE external_identities SET first_name = 'Вера', username = 'vera' WHERE participant_id = $1", [known.id]);
    await pool.query("UPDATE participants SET display_name = 'Вера из Ядра', display_name_chosen_in_core = true WHERE id = $1", [known.id]);
    await join(Number(known.telegram), { first_name: "Другое", username: "other" });
    expect(await shown(Number(known.telegram))).toMatchObject({ display_name: "Вера из Ядра", username: "vera", first_name: "Вера" });
    // A roster contact label is replaced by the person's own name as soon as they come back through the door.
    const labelled = await person();
    await pool.query("UPDATE participants SET display_name = 'Мой смешной контакт' WHERE id = $1", [labelled.id]);
    await join(Number(labelled.telegram), { first_name: "Пётр", last_name: "Сидоров" });
    expect((await shown(Number(labelled.telegram))).display_name).toBe("Пётр Сидоров");
  });

  it("never keeps a roster contact label as a public name: own Telegram name, else @username, else the placeholder", async () => {
    process.env.TELEGRAM_FORUM_CHAT_ID = "-1001725482832";
    const { backfillForumMemberNames } = await import("./telegram-forum-onboarding");
    const nameless = await person(), labelled = await person(), chosen = await person(), loggedIn = await person();
    const setName = (id: string, name: string) => pool.query("UPDATE participants SET display_name = $2 WHERE id = $1", [id, name]);
    // What an MTProto roster import left behind before October 2: the exporter's own label for a contact.
    await setName(labelled.id, "Сантехник Вася (смешной)");
    await pool.query("UPDATE external_identities SET username = 'vasya_real' WHERE participant_id = $1", [labelled.id]);
    await setName(chosen.id, "Имя, выбранное в Ядре");
    await pool.query("UPDATE participants SET display_name_chosen_in_core = true WHERE id = $1", [chosen.id]);
    await setName(loggedIn.id, "Имя со входа");
    await pool.query("INSERT INTO events(event_type, participant_id, payload) VALUES ('participant.logged_in', $1, '{}')", [loggedIn.id]);
    const asked: string[] = [];
    const fetchUser = async (userId: string) => { asked.push(userId);
      return userId === nameless.telegram ? { id: Number(userId), first_name: "Глеб", last_name: "Орлов", username: "gleb" }
        : userId === chosen.telegram ? { id: Number(userId), first_name: "Настоящее", last_name: "Имя" } : null; };
    const name = async (id: string) => String((await pool.query("SELECT display_name FROM participants WHERE id = $1", [id])).rows[0].display_name);

    const dry = await backfillForumMemberNames(pool, false, fetchUser);
    expect(dry.named).toBeGreaterThanOrEqual(2);
    expect(dry.renamed).toBeGreaterThanOrEqual(1);
    expect(await name(labelled.id)).toBe("Сантехник Вася (смешной)");

    await backfillForumMemberNames(pool, true, fetchUser);
    expect(await name(nameless.id)).toBe("Глеб Орлов");
    expect(await name(labelled.id)).toBe("vasya_real");
    expect(await name(chosen.id)).toBe("Имя, выбранное в Ядре");
    expect(await name(loggedIn.id)).toBe("Имя со входа");
    expect((await pool.query("SELECT first_name, last_name FROM external_identities WHERE participant_id = $1", [chosen.id])).rows[0])
      .toEqual({ first_name: "Настоящее", last_name: "Имя" });
    expect(asked).toContain(labelled.telegram);
    const again = await backfillForumMemberNames(pool, true, fetchUser);
    expect(again.renamed).toBe(0);
    expect(await name(labelled.id)).toBe("vasya_real");
  });

  it("tells how a person left exactly: silently from the forum, by decision from the DAO, or not at all", async () => {
    const { getProfileTimelineWithDatabase } = await import("./profile-timeline");
    const event = (id: string, type: string, at: string) => pool.query(
      `INSERT INTO events(event_type, participant_id, created_at, payload) VALUES ($1, $2, $3, $4::jsonb)`,
      [type, id, at, JSON.stringify({ source: "test", observed_at: at })]);
    const day = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;

    const silent = await person();
    await event(silent.id, "forum.joined", "2024-03-01T00:00:00Z"); await event(silent.id, "forum.left", "2026-10-07T10:00:00Z");
    const one = await getProfileTimelineWithDatabase(pool, silent.id);
    expect([day(one.joinedAt), day(one.leftForumAt), day(one.leftDaoAt)]).toEqual(["2024-03-01", "2026-10-07", null]);

    const back = await person();
    await event(back.id, "forum.joined", "2024-03-01T00:00:00Z"); await event(back.id, "forum.left", "2025-01-01T00:00:00Z");
    await event(back.id, "forum.rejoined", "2025-06-01T00:00:00Z");
    expect((await getProfileTimelineWithDatabase(pool, back.id)).leftForumAt).toBeNull();

    // A roster check that saw the person in the forum outranks an older recorded leave.
    const seen = await person();
    await event(seen.id, "forum.left", "2025-01-01T00:00:00Z");
    await pool.query("INSERT INTO participant_forum_onboarding(participant_id, forum_status, observed_at) VALUES ($1, 'joined', now())", [seen.id]);
    expect((await getProfileTimelineWithDatabase(pool, seen.id)).leftForumAt).toBeNull();

    const removed = await person();
    await event(removed.id, "forum.removed", "2026-01-01T00:00:00Z");
    expect((await getProfileTimelineWithDatabase(pool, removed.id)).leftForumAt).toBeNull();

    const decided = await person("left");
    await event(decided.id, "membership.left", "2026-09-01T00:00:00Z");
    expect(day((await getProfileTimelineWithDatabase(pool, decided.id)).leftDaoAt)).toBe("2026-09-01");
    await pool.query("UPDATE participants SET membership_status = 'participant' WHERE id = $1", [decided.id]);
    expect((await getProfileTimelineWithDatabase(pool, decided.id)).leftDaoAt).toBeNull();
  });

  it("restores join history from an export: first join, returns, no duplicates, and a later observed join becomes a return", async () => {
    const { importForumJoins, parseForumJoinEntries, getForumJoinDateWithDatabase, ForumJoinImportValidationError } = await import("./forum-join-history");
    const one = await person(), observed = await person();
    // Core itself saw this person join recently; the export shows they first came long before.
    await pool.query(`INSERT INTO events(event_type, participant_id, payload) VALUES ('forum.joined', $1, $2::jsonb)`,
      [observed.id, JSON.stringify({ source: "chat_member", observed_at: "2026-10-07T13:30:00.000Z" })]);
    const entries = parseForumJoinEntries([
      { telegram_user_id: one.telegram, joins: [{ at: "2025-01-05T10:00:00Z", message_id: 7002 }, { at: "2024-06-01T09:00:00Z", message_id: 7001 }] },
      { telegram_user_id: observed.telegram, joins: [{ at: "2024-12-01T08:00:00Z", message_id: 7003 }] },
      { telegram_user_id: "777777777", joins: [{ at: "2024-01-01T00:00:00Z", message_id: 7004 }] },
    ]);
    const history = async (id: string) => (await pool.query(
      `SELECT event_type, COALESCE((payload->>'observed_at')::timestamptz, created_at) AS created_at, payload->>'source' AS source
         FROM events WHERE participant_id = $1 AND event_type IN ('forum.joined', 'forum.rejoined') ORDER BY 2`, [id])).rows
      .map((row) => `${row.event_type} ${new Date(String(row.created_at)).toISOString().slice(0, 10)} ${row.source}`);
    expect(await importForumJoins(pool, entries, false)).toEqual({ entries: 3, unknown: 1, participants: 2, joined: 2, rejoined: 1, alreadyImported: 0, reclassified: 1, exactKnown: 0 });
    expect(await history(one.id)).toEqual([]);
    expect(await importForumJoins(pool, entries, true)).toMatchObject({ participants: 2, joined: 2, rejoined: 1, reclassified: 1 });
    expect(await history(one.id)).toEqual(["forum.joined 2024-06-01 telegram_export", "forum.rejoined 2025-01-05 telegram_export"]);
    expect(await history(observed.id)).toEqual(["forum.joined 2024-12-01 telegram_export", "forum.rejoined 2026-10-07 chat_member"]);
    expect((await getForumJoinDateWithDatabase(pool, one.id))?.toISOString()).toBe("2024-06-01T09:00:00.000Z");
    expect(await getForumJoinDateWithDatabase(pool, (await person()).id)).toBeNull();
    expect(await importForumJoins(pool, entries, true)).toMatchObject({ participants: 0, joined: 0, rejoined: 0, alreadyImported: 3, reclassified: 0 });
    expect(await history(one.id)).toHaveLength(2);

    // First signs of presence: written only where no join is on record, and never turn a real join into a return.
    const silent = await person();
    const traces = parseForumJoinEntries([
      { telegram_user_id: silent.telegram, joins: [{ at: "2024-03-28T10:18:38Z", message_id: 8001, approximate: true }] },
      { telegram_user_id: observed.telegram, joins: [{ at: "2024-01-01T00:00:00Z", message_id: 8001, approximate: true }] },
    ]);
    expect(await importForumJoins(pool, traces, true)).toMatchObject({ participants: 1, joined: 1, exactKnown: 1, reclassified: 0 });
    expect((await getForumJoinDateWithDatabase(pool, silent.id))?.toISOString()).toBe("2024-03-28T10:18:38.000Z");
    expect((await pool.query("SELECT payload->>'approximate' AS a FROM events WHERE participant_id = $1 AND event_type = 'forum.joined'", [silent.id])).rows[0].a).toBe("true");
    expect(await history(observed.id)).toEqual(["forum.joined 2024-12-01 telegram_export", "forum.rejoined 2026-10-07 chat_member"]);
    expect(await importForumJoins(pool, traces, true)).toMatchObject({ participants: 0, joined: 0, alreadyImported: 1, exactKnown: 1 });
    expect(() => parseForumJoinEntries([{ telegram_user_id: "5", joins: [{ at: "2024-01-01T00:00:00Z", message_id: 1, approximate: true }, { at: "2024-02-01T00:00:00Z", message_id: 2 }] }])).toThrow(ForumJoinImportValidationError);
    expect(() => parseForumJoinEntries([{ telegram_user_id: "5", joins: [] }])).toThrow(ForumJoinImportValidationError);
    expect(() => parseForumJoinEntries([{ telegram_user_id: "5", joins: [{ at: "2024-06-01 09:00", message_id: 1 }] }])).toThrow(ForumJoinImportValidationError);
    expect(() => parseForumJoinEntries([{ telegram_user_id: "5", joins: [{ at: "2999-01-01T00:00:00Z", message_id: 1 }] }])).toThrow(ForumJoinImportValidationError);
  });

  it("sorts the directory by join date: longest in the DAO first, unknown dates last", async () => {
    const { listParticipantsDirectoryWithDatabase } = await import("./participants-directory");
    const tag = `Стаж${Date.now()}`;
    const make = async (name: string, joinedAt: string | null) => {
      const one = await person();
      await pool.query("UPDATE participants SET display_name = $2 WHERE id = $1", [one.id, `${tag} ${name}`]);
      await pool.query("INSERT INTO participant_forum_onboarding(participant_id, forum_status, observed_at) VALUES ($1, 'joined', now())", [one.id]);
      if (joinedAt) await pool.query(`INSERT INTO events(event_type, participant_id, created_at, payload) VALUES ('forum.joined', $1, $2, $3::jsonb)`,
        [one.id, joinedAt, JSON.stringify({ source: "telegram_export", observed_at: joinedAt })]);
    };
    await make("А без даты", null); await make("Б новый", "2025-02-01T00:00:00Z"); await make("В старый", "2023-10-14T00:00:00Z");
    const names = async (sort: "joined" | "name") => (await listParticipantsDirectoryWithDatabase(pool, tag, { sort }))
      .map((entry) => entry.displayName.replace(`${tag} `, ""));
    expect(await names("joined")).toEqual(["В старый", "Б новый", "А без даты"]);
    expect(await names("name")).toEqual(["А без даты", "Б новый", "В старый"]);
  });

  it("rejects a malformed file before touching anyone", () => {
    expect(() => parseIntroductionEntries([{ telegram_user_id: "12", residence: { name: "Москва" }, interests: [] }])).toThrow(IntroductionImportValidationError);
    expect(() => parseIntroductionEntries([{ telegram_user_id: "12", interests: [] }, { telegram_user_id: "12", interests: [] }])).toThrow(IntroductionImportValidationError);
    expect(() => parseIntroductionEntries([{ telegram_user_id: "x" }])).toThrow(IntroductionImportValidationError);
  });
});
