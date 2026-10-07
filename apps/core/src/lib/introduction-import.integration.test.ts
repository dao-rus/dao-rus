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
  });

  it("rejects a malformed file before touching anyone", () => {
    expect(() => parseIntroductionEntries([{ telegram_user_id: "12", residence: { name: "Москва" }, interests: [] }])).toThrow(IntroductionImportValidationError);
    expect(() => parseIntroductionEntries([{ telegram_user_id: "12", interests: [] }, { telegram_user_id: "12", interests: [] }])).toThrow(IntroductionImportValidationError);
    expect(() => parseIntroductionEntries([{ telegram_user_id: "x" }])).toThrow(IntroductionImportValidationError);
  });
});
