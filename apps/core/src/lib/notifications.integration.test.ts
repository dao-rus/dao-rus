import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { listNotificationsWithDatabase, markAllNotificationsReadWithDatabase, openNotificationWithDatabase } from "./notifications";
const url = process.env.NOTIFICATION_TEST_DATABASE_URL;
const schema = `inbox_test_${randomUUID().replaceAll("-", "")}`;
const pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public`, max: 6 });
const owner = randomUUID(), other = randomUUID();
let created = false;
async function add(text: string, action: string | null = null, visible = true, read = false) {
  const result = await pool.query(`INSERT INTO notifications(participant_id,notification_type,text,source_type,created_by_participant_id,action_url,visible_in_inbox,read_at)
    VALUES ($1,'guardian.technical_broadcast',$2,'admin',$1,$3,$4,CASE WHEN $5 THEN now() ELSE NULL END) RETURNING id`, [owner,text,action,visible,read]);
  return String(result.rows[0].id);
}
describe.skipIf(!url)("notification inbox on isolated PostgreSQL", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/notification_tests") throw new Error("Use isolated local notification_tests only");
    await pool.query(`CREATE SCHEMA ${schema}`); created = true;
    await pool.query("CREATE TABLE participants(id uuid PRIMARY KEY)");
    for (const name of ["027_notifications.sql", "029_guardian_campaigns.sql", "031_notification_inbox_visibility.sql"])
      await pool.query(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), "utf8"));
    await pool.query("INSERT INTO participants VALUES ($1),($2)", [owner,other]);
  }, 30000);
  afterAll(async () => { if (created) await pool.query(`DROP SCHEMA ${schema} CASCADE`); await pool.end(); });
  it("filters and sorts unread first/newest, preserving the exact preview", async () => {
    const old = await add("  Дословный текст\n**вторая строка**  ");
    const fresh = await add("Новое"); const read = await add("Прочитанное",null,true,true);
    const hidden = await add("Скрытое",null,false);
    await pool.query("UPDATE notifications SET created_at=now()-interval '1 day' WHERE id=$1", [old]);
    expect((await listNotificationsWithDatabase(pool,owner)).map(n=>n.id)).toEqual([fresh,old,read]);
    const unread = await listNotificationsWithDatabase(pool,owner,true);
    expect(unread.map(n=>n.id)).toEqual([fresh,old]);
    expect(unread[1].preview).toBe("  Дословный текст\n**вторая строка**  ");
    expect(await listNotificationsWithDatabase(pool,other)).toEqual([]);
    expect(await openNotificationWithDatabase(pool,owner,hidden)).toBeNull();
  });
  it("opens only the recipient's stored permitted URL and preserves read time under concurrency", async () => {
    const id = await add("Открыть","/relay/example");
    expect(await openNotificationWithDatabase(pool,other,id)).toBeNull();
    expect((await pool.query("SELECT read_at FROM notifications WHERE id=$1",[id])).rows[0].read_at).toBeNull();
    const results = await Promise.all([openNotificationWithDatabase(pool,owner,id),openNotificationWithDatabase(pool,owner,id)]);
    expect(results).toEqual([{actionUrl:"/relay/example"},{actionUrl:"/relay/example"}]);
    const first = (await pool.query("SELECT read_at FROM notifications WHERE id=$1",[id])).rows[0].read_at;
    await openNotificationWithDatabase(pool,owner,id);
    expect((await pool.query("SELECT read_at FROM notifications WHERE id=$1",[id])).rows[0].read_at).toEqual(first);
    expect(await openNotificationWithDatabase(pool,owner,await add("Без ссылки"))).toEqual({actionUrl:null});
    expect(await openNotificationWithDatabase(pool,owner,await add("Внешняя ссылка","https://t.me/example"))).toEqual({actionUrl:"https://t.me/example"});
  });
  it.each(["//evil.example", "javascript:alert(1)", "/\\evil.example", "https://user:password@example.org"])("rejects unsafe persisted URL %s without marking read", async (action) => {
    const id = await add("Небезопасная ссылка",action);
    await expect(openNotificationWithDatabase(pool,owner,id)).rejects.toThrow("Invalid notification action URL");
    expect((await pool.query("SELECT read_at FROM notifications WHERE id=$1",[id])).rows[0].read_at).toBeNull();
  });
  it("marks all only for the recipient, skips hidden and preserves prior timestamps", async () => {
    const hidden = await add("Скрытое",null,false);
    const foreign = (await pool.query(`INSERT INTO notifications(participant_id,notification_type,text,source_type)
      VALUES ($1,'test','Чужое','system') RETURNING id`,[other])).rows[0].id;
    await add("Новое");
    const previous = (await pool.query("SELECT id,read_at FROM notifications WHERE participant_id=$1 AND read_at IS NOT NULL",[owner])).rows;
    const changed = await Promise.all([markAllNotificationsReadWithDatabase(pool,owner),markAllNotificationsReadWithDatabase(pool,owner)]);
    expect(changed.reduce((a,b)=>a+b,0)).toBeGreaterThan(0);
    expect(await markAllNotificationsReadWithDatabase(pool,owner)).toBe(0);
    expect((await pool.query("SELECT read_at FROM notifications WHERE id=ANY($1::uuid[])",[[hidden,foreign]])).rows.every(r=>r.read_at===null)).toBe(true);
    for (const row of previous) expect((await pool.query("SELECT read_at FROM notifications WHERE id=$1",[row.id])).rows[0].read_at).toEqual(row.read_at);
  });
});
