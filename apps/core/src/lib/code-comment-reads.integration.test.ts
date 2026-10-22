import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { markCodeCommentsReadWithDatabase, unreadCodeCommentsWithDatabase } from "./code-comment-reads";

const url = process.env.NOTIFICATION_TEST_DATABASE_URL;
const schema = `code_reads_${randomUUID().replaceAll("-", "")}`;
const db = new Pool({ connectionString: url, options: `-c search_path=${schema},public` });
let created = false;

describe.skipIf(!url)("per-participant Code comment reads", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/notification_tests") throw new Error("Use isolated local notification_tests only");
    await db.query(`CREATE SCHEMA ${schema}`); created = true;
    await db.query("CREATE TABLE participants(id uuid PRIMARY KEY)");
    for (const name of ["022_code_comments.sql", "064_code_comment_reads.sql"]) {
      await db.query(readFileSync(new URL(`../../migrations/${name}`, import.meta.url), "utf8"));
    }
  });
  afterAll(async () => { if (created) await db.query(`DROP SCHEMA ${schema} CASCADE`); await db.end(); });

  it("counts visible roots and replies independently, marking only supplied visible comments", async () => {
    const a = randomUUID(), b = randomUUID();
    await db.query("INSERT INTO participants(id) VALUES ($1), ($2)", [a, b]);
    const root = (await db.query("INSERT INTO code_comments(section_key,author_id,body) VALUES ('dao-code-1',$1,'root') RETURNING id", [a])).rows[0].id;
    const reply = (await db.query("INSERT INTO code_comments(section_key,author_id,parent_id,body) VALUES ('dao-code-1',$1,$2,'reply') RETURNING id", [a, root])).rows[0].id;
    const other = (await db.query("INSERT INTO code_comments(section_key,author_id,body) VALUES ('dao-code-2',$1,'other') RETURNING id", [a])).rows[0].id;
    const hidden = (await db.query("INSERT INTO code_comments(section_key,author_id,body,hidden_at,hidden_by,hidden_reason) VALUES ('dao-code-1',$1,'hidden',now(),$1,'reason') RETURNING id", [a])).rows[0].id;
    const deleted = (await db.query("INSERT INTO code_comments(section_key,author_id,body,deleted_at) VALUES ('dao-code-1',$1,NULL,now()) RETURNING id", [a])).rows[0].id;
    expect((await unreadCodeCommentsWithDatabase(db, a))?.count).toBe(3);
    await markCodeCommentsReadWithDatabase(db, a, [root, reply, hidden, deleted]);
    await markCodeCommentsReadWithDatabase(db, a, [root, reply]);
    expect(await unreadCodeCommentsWithDatabase(db, a)).toMatchObject({ count: 1, id: other, section: "dao-code-2" });
    expect((await unreadCodeCommentsWithDatabase(db, b))?.count).toBe(3);
    expect((await db.query("SELECT count(*)::int AS n FROM code_comment_reads WHERE participant_id=$1", [a])).rows[0].n).toBe(2);
    await db.query("UPDATE code_comments SET hidden_at=NULL, hidden_by=NULL, hidden_reason=NULL WHERE id=$1", [hidden]);
    expect((await unreadCodeCommentsWithDatabase(db, a))?.count).toBe(2);
    await markCodeCommentsReadWithDatabase(db, a, [hidden, other]);
    expect(await unreadCodeCommentsWithDatabase(db, a)).toBeNull();
    expect((await unreadCodeCommentsWithDatabase(db, b))?.count).toBe(4);
  });
});
