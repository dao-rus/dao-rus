import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigration, migrationFile } from "./migration-integrity";
import {
  readGuardianSettingsWithDatabase, saveGuardianForumSettingsWithDatabase, GUARDIAN_FEATURES,
  type ForumBot, type ForumButton, type GuardianFeature, type GuardianSettings,
} from "./guardian-forum";
import { interfaceTextFields, type InterfaceTextValues } from "./interface-texts";
import { miniAppActionUrl } from "./notification-delivery";
import { isNewcomerWithDatabase, setForumAnnouncementWithDatabase, syncNewcomerAnnouncement } from "./newcomer-announcement";
import { openDiscussion, readDiscussionLinkWithDatabase, syncDiscussion } from "./signal-discussion";
import { archiveSignalWithDatabase, createSignalWithDatabase, updateSignalWithDatabase } from "./signals";
import { encodeStartPath } from "./mini-app-start";

const databaseUrl = process.env.GUARDIAN_FORUM_TEST_DATABASE_URL;
const schema = `guardian_forum_test_${randomUUID().replaceAll("-", "")}`;
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 12 });
const directory = new URL("../../migrations/", import.meta.url);
const files = readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()
  .map((name) => migrationFile(name, readFileSync(new URL(name, directory), "utf8")));
const texts = Object.fromEntries(interfaceTextFields.map((field) => [field.key, field.defaultValue])) as InterfaceTextValues;
const forumChatId = "-1001725482832", baseUrl = "https://core.daorus.org";
let schemaCreated = false;

type Sent = { kind: "send" | "edit"; topicId?: number; messageId: number; text: string; buttons: ForumButton[] };
function fakeBot() {
  const calls: Sent[] = []; let next = 1000; let failure: Error | null = null;
  const bot: ForumBot = {
    async send(topicId, text, buttons) {
      await new Promise((resolve) => setTimeout(resolve, 15));
      if (failure) throw failure;
      const messageId = next++; calls.push({ kind: "send", topicId, messageId, text, buttons }); return messageId;
    },
    async edit(messageId, text, buttons) { if (failure) throw failure; calls.push({ kind: "edit", messageId, text, buttons }); },
  };
  return { bot, calls, fail: (error: Error | null) => { failure = error; } };
}
const settingsOf = (entries: Record<string, string>): GuardianSettings => new Map(Object.entries(entries));
const topics = settingsOf({ "topic.discussion.need": "18350", "topic.discussion.idea": "298", "topic.newcomers": "90117", "miniapp.bot": "DaoRusBot" });

async function person(name = "Участник", old = false) {
  const id = randomUUID();
  await pool.query("INSERT INTO participants(id, display_name, membership_status, created_at) VALUES ($1, $2, 'participant', now() - $3::interval)", [id, name, old ? "30 days" : "-1 minute"]);
  return id;
}
const record = async (owner: string, visibility = "members", typeKey = "need", label = "Нужен совет") =>
  (await createSignalWithDatabase(pool, owner, { typeKey, label, description: "Подробности записи", visibility })).signal.id;

describe.skipIf(!databaseUrl)("Guardian forum routes on real PostgreSQL", () => {
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
  let forum: ReturnType<typeof fakeBot>;
  beforeEach(() => { forum = fakeBot(); });
  const deps = (settings: GuardianSettings = topics) => ({ database: pool, bot: forum.bot, forumChatId, settings, texts, baseUrl });

  it("publishes one forum message per record, whoever and however many press the button", async () => {
    const author = await person("Анна Автор"), readers = await Promise.all(Array.from({ length: 8 }, () => person()));
    const id = await record(author);
    const results = await Promise.all(readers.map((reader) => openDiscussion(deps(), reader, id)));
    expect(forum.calls.filter((call) => call.kind === "send")).toHaveLength(1);
    const opened = results.filter((result) => result.status === "open");
    expect(opened.filter((result) => result.status === "open" && result.created)).toHaveLength(1);
    expect(results.every((result) => result.status === "open" || result.status === "pending")).toBe(true);
    const message = forum.calls[0];
    expect(message).toMatchObject({ topicId: 18350, text: "Нужно · Анна Автор\n\nНужен совет\n\nПодробности записи" });
    expect(message.buttons).toEqual([
      { text: "Открыть запись", url: `https://t.me/DaoRusBot?startapp=${encodeStartPath(`/exchange/${id}`)}` },
      { text: "Добавить свою запись", url: `https://t.me/DaoRusBot?startapp=${encodeStartPath("/exchange/new?type=need")}` }]);
    const link = `https://t.me/c/1725482832/18350/${message.messageId}`;
    expect(await readDiscussionLinkWithDatabase(pool, id, forumChatId)).toBe(link);
    // Later presses lead to the same message and notify nobody again; the author opening it is not notified at all.
    expect(await openDiscussion(deps(), readers[0], id)).toEqual({ status: "open", link, created: false, authorId: null });
    expect(await openDiscussion(deps(), author, id)).toMatchObject({ status: "open", created: false });
    expect(forum.calls).toHaveLength(1);
    const first = opened.find((result) => result.status === "open" && result.created);
    expect(first).toMatchObject({ authorId: author });
    const events = await pool.query("SELECT payload FROM events WHERE event_type = 'signal.discussion_opened' AND payload->>'signal_id' = $1", [id]);
    expect(events.rows).toHaveLength(1);
    expect(Object.keys(events.rows[0].payload).sort()).toEqual(["signal_id", "topic_id"]);
  });

  it("never takes anonymous, hidden, archived or Closer records to the forum, nor a type without a topic", async () => {
    const author = await person(), reader = await person();
    for (const [visibility, typeKey] of [["network_blind", "need"], ["private", "need"], ["match_only", "need"], ["circle", "need"],
      ["match_only", "dating"], ["members", "can"]] as const) {
      expect(await openDiscussion(deps(), reader, await record(author, visibility, typeKey)), `${visibility}/${typeKey}`).toEqual({ status: "unavailable" });
    }
    const archived = await record(author);
    await archiveSignalWithDatabase(pool, author, archived);
    expect(await openDiscussion(deps(), reader, archived)).toEqual({ status: "unavailable" });
    const open = await record(author, "public");
    expect(await openDiscussion(deps(settingsOf({ "topic.discussion.need": "18350", "feature.exchange_discussion": "off" })), reader, open)).toEqual({ status: "unavailable" });
    expect(await openDiscussion(deps(), reader, "not-a-uuid")).toEqual({ status: "unavailable" });
    expect(forum.calls).toHaveLength(0);
    expect((await pool.query("SELECT count(*)::int AS n FROM signal_discussions WHERE signal_id = ANY($1::uuid[])", [[archived, open]])).rows[0].n).toBe(0);
  });

  it("leaves nothing behind when Telegram refuses, and takes over a claim that never got its message", async () => {
    const author = await person(), reader = await person(), id = await record(author, "public", "idea");
    forum.fail(new Error("not enough rights"));
    await expect(openDiscussion(deps(), reader, id)).rejects.toThrow("not enough rights");
    expect((await pool.query("SELECT count(*)::int AS n FROM signal_discussions WHERE signal_id = $1", [id])).rows[0].n).toBe(0);
    forum.fail(null);
    // A crash between claiming and sending: the fresh claim blocks, the stale one is taken over.
    await pool.query("INSERT INTO signal_discussions(signal_id, topic_id, opened_by) VALUES ($1, 298, $2)", [id, reader]);
    expect(await openDiscussion(deps(), reader, id)).toEqual({ status: "pending" });
    await pool.query("UPDATE signal_discussions SET updated_at = now() - interval '2 minutes' WHERE signal_id = $1", [id]);
    expect(await openDiscussion(deps(), reader, id)).toMatchObject({ status: "open", created: true });
    expect(forum.calls.filter((call) => call.kind === "send")).toHaveLength(1);
  });

  it("keeps the forum message true to the record and withdraws its text when the record is closed", async () => {
    const author = await person("Борис Автор"), reader = await person(), id = await record(author, "public");
    expect(await syncDiscussion(deps(), id)).toBe("none");
    await openDiscussion(deps(), reader, id);
    const messageId = forum.calls[0].messageId;
    await updateSignalWithDatabase(pool, author, id, { label: "Нужен юрист", description: null, visibility: "members" });
    expect(await syncDiscussion(deps(), id)).toBe("updated");
    expect(forum.calls.at(-1)).toMatchObject({ kind: "edit", messageId, text: "Нужно · Борис Автор\n\nНужен юрист" });
    await updateSignalWithDatabase(pool, author, id, { label: "Нужен юрист", visibility: "private" });
    expect(await syncDiscussion(deps(), id)).toBe("withdrawn");
    expect(forum.calls.at(-1)).toEqual({ kind: "edit", messageId, text: "Запись снята автором.", buttons: [] });
    expect(await readDiscussionLinkWithDatabase(pool, id, forumChatId)).toBeNull();
    const edits = forum.calls.length;
    expect(await syncDiscussion(deps(), id)).toBe("withdrawn");
    expect(forum.calls).toHaveLength(edits);
    // Reopened to the DAO: the same message comes back; archiving withdraws it for good.
    await updateSignalWithDatabase(pool, author, id, { label: "Нужен юрист", visibility: "members" });
    expect(await syncDiscussion(deps(), id)).toBe("updated");
    expect(await readDiscussionLinkWithDatabase(pool, id, forumChatId)).toContain(`/${messageId}`);
    await archiveSignalWithDatabase(pool, author, id);
    expect(await syncDiscussion(deps(), id)).toBe("withdrawn");
    expect(forum.calls.filter((call) => call.kind === "send")).toHaveLength(1);
  });

  it("announces only people who joined after the feature, once, with what the profile already shows", async () => {
    const veteran = await person("Старожил", true), newcomer = await person("Иван Новичок");
    expect(await isNewcomerWithDatabase(pool, veteran)).toBe(false);
    expect(await isNewcomerWithDatabase(pool, newcomer)).toBe(true);
    await pool.query("UPDATE participants SET residence_name='Казань', residence_type='город', residence_country='Россия' WHERE id = ANY($1::uuid[])", [[veteran, newcomer]]);
    expect(await syncNewcomerAnnouncement(deps(), veteran)).toBe("none");
    const empty = await person("Без данных");
    expect(await syncNewcomerAnnouncement(deps(), empty)).toBe("none");
    const results = await Promise.all(Array.from({ length: 6 }, () => syncNewcomerAnnouncement(deps(), newcomer)));
    expect(results.filter((result) => result === "announced")).toHaveLength(1);
    expect(forum.calls.filter((call) => call.kind === "send")).toHaveLength(1);
    expect(forum.calls[0]).toMatchObject({ topicId: 90117, text: "Новый участник: Иван Новичок\nГород: Казань" });
    expect(forum.calls[0].buttons.map((button) => button.text)).toEqual(["Профиль", "Кто рядом"]);
    const messageId = forum.calls[0].messageId;

    await pool.query(`INSERT INTO participant_interests(participant_id, label, normalized_label, visibility)
      VALUES ($1, 'история', 'история', 'members'), ($1, 'тайное', 'тайное', 'private'), ($1, 'столярка', 'столярка', 'public')`, [newcomer]);
    expect(await syncNewcomerAnnouncement(deps(), newcomer)).toBe("updated");
    expect(forum.calls.at(-1)).toMatchObject({ kind: "edit", messageId, text: "Новый участник: Иван Новичок\nГород: Казань\nИнтересы: история, столярка" });

    // The person's own switch wins in both directions, even after announcements are turned off.
    await setForumAnnouncementWithDatabase(pool, newcomer, false);
    const off = deps(settingsOf({ "topic.newcomers": "90117", "feature.newcomer_announcements": "off" }));
    expect(await syncNewcomerAnnouncement(off, newcomer)).toBe("hidden");
    expect(forum.calls.at(-1)).toEqual({ kind: "edit", messageId, text: "Объявление скрыто участником.", buttons: [] });
    await setForumAnnouncementWithDatabase(pool, newcomer, true);
    expect(await syncNewcomerAnnouncement(deps(), newcomer)).toBe("updated");

    // An applicant who signed in to Core and filled in a city is not introduced until accepted into the forum.
    const applicant = await person("Соискатель");
    await pool.query("UPDATE participants SET membership_status='none', residence_name='Пермь', residence_type='город', residence_country='Россия' WHERE id=$1", [applicant]);
    expect(await syncNewcomerAnnouncement(deps(), applicant)).toBe("none");
    await pool.query("UPDATE participants SET membership_status='participant' WHERE id=$1", [applicant]);
    expect(await syncNewcomerAnnouncement(deps(), applicant)).toBe("announced");
    expect(forum.calls.at(-1)).toMatchObject({ kind: "send", text: "Новый участник: Соискатель\nГород: Пермь" });

    const shy = await person("Не объявлять");
    await pool.query("UPDATE participants SET residence_name='Тверь', residence_type='город', residence_country='Россия', announce_in_forum=false WHERE id=$1", [shy]);
    expect(await syncNewcomerAnnouncement(deps(), shy)).toBe("none");
    const late = await person("Функция выключена");
    await pool.query("UPDATE participants SET residence_name='Тула', residence_type='город', residence_country='Россия' WHERE id=$1", [late]);
    expect(await syncNewcomerAnnouncement(off, late)).toBe("none");
    expect(await syncNewcomerAnnouncement(deps(settingsOf({})), late)).toBe("none");
    expect(forum.calls.filter((call) => call.kind === "send")).toHaveLength(2);
  });

  it("stores switches, bot name and topics, records what changed, and defaults every switch to on", async () => {
    const admin = await person();
    const all = Object.fromEntries(GUARDIAN_FEATURES.map((feature) => [feature, true])) as Record<GuardianFeature, boolean>;
    expect(await saveGuardianForumSettingsWithDatabase(pool, admin, { features: all, botUsername: null, topics: {} })).toEqual([]);
    const changed = await saveGuardianForumSettingsWithDatabase(pool, admin, {
      features: { ...all, newcomer_announcements: false }, botUsername: "DaoRusBot", topics: { "topic.newcomers": 90117, "topic.discussion.need": 18350 } });
    expect(changed.sort()).toEqual(["feature.newcomer_announcements", "miniapp.bot", "topic.discussion.need", "topic.newcomers"]);
    const stored = await readGuardianSettingsWithDatabase(pool);
    expect(Object.fromEntries([...stored].filter(([key]) => key !== "newcomers.since")))
      .toEqual({ "feature.newcomer_announcements": "off", "miniapp.bot": "DaoRusBot", "topic.newcomers": "90117", "topic.discussion.need": "18350" });
    expect(await saveGuardianForumSettingsWithDatabase(pool, admin, { features: all, botUsername: "DaoRusBot", topics: { "topic.newcomers": null, "topic.discussion.need": 18350 } }))
      .toEqual(["feature.newcomer_announcements", "topic.newcomers"]);
    await expect(saveGuardianForumSettingsWithDatabase(pool, admin, { features: all, botUsername: null, topics: { "newcomers.since": 1 } })).rejects.toThrow();
    expect((await pool.query("SELECT count(*)::int AS n FROM events WHERE event_type='guardian.forum_settings_updated' AND participant_id=$1", [admin])).rows[0].n).toBe(2);

    // Private notifications: internal actions open the Mini App entry with the target; external ones stay links.
    expect(await miniAppActionUrl(pool, "/exchange?type=dating", baseUrl)).toBe(`https://core.daorus.org/need?start=${encodeStartPath("/exchange?type=dating")}`);
    expect(await miniAppActionUrl(pool, "https://t.me/c/1/2/3", baseUrl)).toBeNull();
    expect(await miniAppActionUrl(pool, null, baseUrl)).toBeNull();
    expect(await miniAppActionUrl(pool, "/x", "http://localhost:3000")).toBeNull();
    await pool.query("INSERT INTO guardian_settings(key, value) VALUES ('feature.notification_mini_app', 'off')");
    expect(await miniAppActionUrl(pool, "/exchange?type=dating", baseUrl)).toBeNull();
  });
});
