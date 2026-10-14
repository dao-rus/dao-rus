import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { changeCodeCommentWithDatabase, CodeCommentRateLimitError, CodeCommentValidationError } from "./code-comments";
import { countUnreadNotificationsWithDatabase, createNotificationWithClient, listNotificationsWithDatabase, openNotificationWithDatabase } from "./notifications";

const url = process.env.NOTIFICATION_TEST_DATABASE_URL;
const schema = `code_reply_test_${randomUUID().replaceAll("-", "")}`;
const pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public`, max: 6 });
let created = false;

async function fixture(self = false) {
  const actor = randomUUID(), owner = randomUUID();
  await pool.query("INSERT INTO participants(id) VALUES ($1),($2)", [actor, owner]);
  const parent = (await pool.query(`INSERT INTO code_comments(section_key,author_id,body,created_at)
    VALUES ('dao-code-1',$1,'Исходный комментарий',now()-interval '1 minute') RETURNING id`, [self ? actor : owner])).rows[0].id as string;
  return { actor, owner, parent };
}

async function state(actor: string, owner: string) {
  return (await pool.query(`SELECT
    (SELECT count(*)::integer FROM code_comments WHERE author_id=$1) AS comments,
    (SELECT count(*)::integer FROM events WHERE participant_id=$1) AS events,
    (SELECT count(*)::integer FROM notifications WHERE participant_id=$2) AS notices,
    (SELECT count(*)::integer FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id
      WHERE n.participant_id=$2) AS deliveries`, [actor, owner])).rows[0];
}

describe.skipIf(!url)("Code reply notifications on isolated PostgreSQL", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/notification_tests") throw new Error("Use isolated local notification_tests only");
    await pool.query(`CREATE SCHEMA ${schema}`); created = true;
    await pool.query("CREATE TABLE participants(id uuid PRIMARY KEY)");
    await pool.query("CREATE TABLE events(event_type text NOT NULL, participant_id uuid REFERENCES participants(id), payload jsonb NOT NULL)");
    for (const name of ["011_interface_texts.sql", "021_drop_interface_text_key_check.sql", "022_code_comments.sql",
      "027_notifications.sql", "028_notification_processing.sql", "029_guardian_campaigns.sql", "031_notification_inbox_visibility.sql"]) {
      await pool.query(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), "utf8"));
    }
  }, 30000);
  afterAll(async () => { if (created) await pool.query(`DROP SCHEMA ${schema} CASCADE`); await pool.end(); });

  it("commits one reply, event, recipient-only unread notification and pending Telegram delivery", async () => {
    const { actor, owner, parent } = await fixture();
    await changeCodeCommentWithDatabase(pool, actor, false, { action: "create", section: "dao-code-1", parentId: parent, body: "Ответ" });
    const reply = (await pool.query("SELECT id,parent_id FROM code_comments WHERE author_id=$1", [actor])).rows[0];
    expect(reply.parent_id).toBe(parent);
    const notice = (await listNotificationsWithDatabase(pool, owner))[0];
    expect(notice).toMatchObject({ id: reply.id, actionUrl: `/code?section=dao-code-1#comment-${reply.id}`, readAt: null, preview: null });
    expect(notice.text).not.toContain("Исходный комментарий");
    expect(await countUnreadNotificationsWithDatabase(pool, owner)).toBe(1);
    expect(await countUnreadNotificationsWithDatabase(pool, actor)).toBe(0);
    expect(await listNotificationsWithDatabase(pool, actor)).toEqual([]);
    expect(await openNotificationWithDatabase(pool, actor, notice.id)).toBeNull();
    expect(await openNotificationWithDatabase(pool, owner, notice.id)).toEqual({ actionUrl: notice.actionUrl });
    expect(await countUnreadNotificationsWithDatabase(pool, owner)).toBe(0);
    expect(await state(actor, owner)).toEqual({ comments: 1, events: 1, notices: 1, deliveries: 1 });
    expect((await pool.query("SELECT status FROM notification_deliveries WHERE notification_id=$1", [notice.id])).rows[0].status).toBe("pending");

    // Later edits and moderation do not create another notification or copy the changed body.
    await changeCodeCommentWithDatabase(pool, actor, false, { action: "edit", section: "dao-code-1", commentId: reply.id, body: "Изменённый ответ" });
    await changeCodeCommentWithDatabase(pool, owner, true, { action: "hide", section: "dao-code-1", commentId: reply.id, reason: "Модерация" });
    expect(await countUnreadNotificationsWithDatabase(pool, owner)).toBe(0);
    expect((await listNotificationsWithDatabase(pool, owner))[0].text).toBe(notice.text);
    expect((await state(actor, owner)).notices).toBe(1);
  });

  it.each([false, true])("creates no notification for a root or self reply (self=%s)", async (self) => {
    const { actor, owner, parent } = await fixture(self);
    await changeCodeCommentWithDatabase(pool, actor, false, {
      action: "create", section: "dao-code-1", parentId: self ? parent : null, body: "Текст",
    });
    expect(await listNotificationsWithDatabase(pool, owner)).toEqual([]);
    expect(await listNotificationsWithDatabase(pool, actor)).toEqual([]);
  });

  it("serializes concurrent submissions so the retry cannot duplicate a reply or its notification", async () => {
    const { actor, owner, parent } = await fixture();
    const results = await Promise.allSettled([0, 1].map(() => changeCodeCommentWithDatabase(pool, actor, false, {
      action: "create", section: "dao-code-1", parentId: parent, body: "Одновременный ответ",
    })));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const failure = results.find(r => r.status === "rejected") as PromiseRejectedResult;
    expect(failure.reason).toBeInstanceOf(CodeCommentRateLimitError);
    expect(await state(actor, owner)).toEqual({ comments: 1, events: 1, notices: 1, deliveries: 1 });
  });

  it("deduplicates concurrent notification replay by reply UUID without requeueing an attempted delivery", async () => {
    const { owner } = await fixture();
    const id = randomUUID();
    async function replay() {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await createNotificationWithClient(client, {
          participantId: owner, notificationType: "code.comment_reply", text: "Получен ответ", sourceType: "system", queueTelegram: true,
        }, id);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    }
    await Promise.all([replay(), replay()]);
    await pool.query("UPDATE notification_deliveries SET status='unknown',attempted_at=now() WHERE notification_id=$1", [id]);
    await replay();
    expect((await listNotificationsWithDatabase(pool, owner)).map(n => n.id)).toEqual([id]);
    const deliveries = (await pool.query("SELECT status FROM notification_deliveries WHERE notification_id=$1", [id])).rows;
    expect(deliveries).toEqual([{ status: "unknown" }]);
  });

  it.each(["events", "notifications", "notification_deliveries"])("rolls back the entire reply if %s insertion fails", async (table) => {
    const { actor, owner, parent } = await fixture();
    await pool.query("CREATE FUNCTION fail_reply_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected insertion failure'; END $$");
    await pool.query(`CREATE TRIGGER fail_reply_insert BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_reply_insert()`);
    try {
      await expect(changeCodeCommentWithDatabase(pool, actor, false, {
        action: "create", section: "dao-code-1", parentId: parent, body: "Ответ с откатом",
      })).rejects.toThrow("injected insertion failure");
      expect(await state(actor, owner)).toEqual({ comments: 0, events: 0, notices: 0, deliveries: 0 });
    } finally {
      await pool.query(`DROP TRIGGER fail_reply_insert ON ${table}`);
      await pool.query("DROP FUNCTION fail_reply_insert()");
    }
  });

  it.each(["hidden", "deleted", "reply", "section", "missing"])("rejects an invalid reply target (%s) without notifying", async (kind) => {
    const { actor, owner, parent } = await fixture();
    let target = parent;
    if (kind === "hidden") await pool.query("UPDATE code_comments SET hidden_at=now(),hidden_by=$1,hidden_reason='Причина' WHERE id=$2", [owner, parent]);
    if (kind === "deleted") await pool.query("UPDATE code_comments SET deleted_at=now(),body=NULL WHERE id=$1", [parent]);
    if (kind === "reply") target = (await pool.query("INSERT INTO code_comments(section_key,author_id,parent_id,body) VALUES ('dao-code-1',$1,$2,'Другой ответ') RETURNING id", [owner, parent])).rows[0].id;
    if (kind === "section") await pool.query("UPDATE code_comments SET section_key='dao-code-2' WHERE id=$1", [parent]);
    if (kind === "missing") target = randomUUID();
    await expect(changeCodeCommentWithDatabase(pool, actor, false, {
      action: "create", section: "dao-code-1", parentId: target, body: "Нельзя ответить",
    })).rejects.toBeInstanceOf(CodeCommentValidationError);
    expect(await state(actor, owner)).toEqual({ comments: 0, events: 0, notices: 0, deliveries: 0 });
  });
});
