import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { handleHubAdmissionCallback, processHubAdmissionDecisions, receiveHubJoinRequest } from "./telegram-hub-admission";
import { ensureTestPgcrypto } from "./test-postgres-extensions";

const url = process.env.HUB_ADMISSION_TEST_DATABASE_URL;
const schema = `hub_admission_test_${randomUUID().replaceAll("-", "")}`;
const db = new Pool({ connectionString: url, options: `-c search_path=${schema},public`, max: 8 });
let created = false;
const bot = (fn: (method: string, params: Record<string, unknown>) => Promise<{ ok: boolean; result?: unknown }>) => fn;
const join = (updateId: number, userId = 42) => ({ update_id: updateId, chat_join_request: {
  chat: { id: -100123 }, from: { id: userId }, user_chat_id: userId,
  date: Math.floor(Date.now() / 1000),
} });
const callback = (action: "yes" | "no", id: string, userId = 42) => ({ callback_query: {
  id: `callback-${id}`, from: { id: userId }, data: `ha:${action}:${id}`,
} });

describe.skipIf(!url)("Telegram hub admission PostgreSQL integration", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/reception_tests") {
      throw new Error("Use only local reception_tests for hub admission integration tests");
    }
    await db.query(`CREATE SCHEMA ${schema}`); created = true;
    await ensureTestPgcrypto(db);
    const dir = new URL("../../migrations/", import.meta.url);
    for (const name of readdirSync(dir).filter((file) => file.endsWith(".sql")).sort()) {
      await db.query(readFileSync(new URL(name, dir), "utf8"));
    }
    await db.query(`INSERT INTO telegram_hubs(id,chat_id,title,code_version) VALUES ('test_hub',-100123,'Test','0.1')`);
  }, 60000);
  beforeEach(async () => {
    await db.query("TRUNCATE telegram_hub_join_requests CASCADE");
    await db.query("TRUNCATE telegram_hubs CASCADE");
    await db.query("DELETE FROM verification_roots");
    await db.query("DELETE FROM participants");
    await db.query("DELETE FROM events");
    await db.query("INSERT INTO telegram_hubs(id,chat_id,title,code_version) VALUES ('test_hub',-100123,'Test','0.1')");
  });
  afterAll(async () => {
    if (created) await db.query(`DROP SCHEMA ${schema} CASCADE`);
    await db.end();
  });

  it("accepts into a hub without granting DAO membership or verification", async () => {
    const transport = bot(async (method) => ({ ok: true, result: method === "approveChatJoinRequest" }));
    await receiveHubJoinRequest(join(101), db, transport);
    const requestId = String((await db.query("SELECT id FROM telegram_hub_join_requests")).rows[0].id);
    await handleHubAdmissionCallback(callback("yes", requestId), db, transport);
    const member = (await db.query(`SELECT p.membership_status,
      EXISTS(SELECT 1 FROM verification_roots v WHERE v.subject_id=p.id) AS root,
      m.code_version, m.accepted_at, r.status
      FROM telegram_hub_memberships m JOIN participants p ON p.id=m.participant_id
      JOIN telegram_hub_join_requests r ON r.id=m.join_request_id`)).rows[0];
    expect(member).toMatchObject({ membership_status: "none", root: false, code_version: "0.1", status: "approved" });
    expect(member.accepted_at).toBeInstanceOf(Date);
  });

  it("keeps an existing verified institutional identity unchanged", async () => {
    const existing = (await db.query(`INSERT INTO participants(display_name,membership_status)
      VALUES ('Existing','participant') RETURNING id`)).rows[0].id;
    await db.query(`INSERT INTO verification_roots(subject_id,added_by_participant_id) VALUES ($1,$1)`, [existing]);
    await db.query(`INSERT INTO external_identities(participant_id,provider,provider_subject,external_user_id)
      VALUES ($1,'telegram','oidc:42','42')`, [existing]);
    await receiveHubJoinRequest(join(102), db, bot(async () => ({ ok: true })));
    const requestId = String((await db.query("SELECT id FROM telegram_hub_join_requests")).rows[0].id);
    await handleHubAdmissionCallback(callback("yes", requestId), db, bot(async () => ({ ok: true })));
    expect((await db.query("SELECT membership_status FROM participants WHERE id=$1", [existing])).rows[0].membership_status).toBe("participant");
    expect((await db.query("SELECT count(*)::int AS count FROM participants")).rows[0].count).toBe(1);
    expect((await db.query("SELECT count(*)::int AS count FROM verification_roots WHERE subject_id=$1", [existing])).rows[0].count).toBe(1);
  });

  it("declines refusal, expires after 24 hours, and allows a fresh request", async () => {
    const calls: string[] = [];
    const transport = bot(async (method) => { calls.push(method); return { ok: true }; });
    await receiveHubJoinRequest(join(103), db, transport);
    let requestId = String((await db.query("SELECT id FROM telegram_hub_join_requests")).rows[0].id);
    await handleHubAdmissionCallback(callback("no", requestId), db, transport);
    expect(calls).toContain("declineChatJoinRequest");
    await receiveHubJoinRequest(join(104), db, transport);
    requestId = String((await db.query("SELECT id FROM telegram_hub_join_requests WHERE telegram_update_id=104")).rows[0].id);
    await db.query("UPDATE telegram_hub_join_requests SET expires_at=now()-interval '1 second' WHERE id=$1", [requestId]);
    await processHubAdmissionDecisions(db, transport);
    expect((await db.query("SELECT status FROM telegram_hub_join_requests WHERE id=$1", [requestId])).rows[0].status).toBe("declined");
    await receiveHubJoinRequest(join(105), db, transport);
    expect((await db.query("SELECT count(*)::int AS count FROM telegram_hub_join_requests WHERE telegram_user_id='42' AND status='pending'")).rows[0].count).toBe(1);
  });

  it("retries approval after a transient Telegram error without duplicating consent", async () => {
    await receiveHubJoinRequest(join(106), db, bot(async () => ({ ok: true })));
    const requestId = String((await db.query("SELECT id FROM telegram_hub_join_requests")).rows[0].id);
    const first = bot(async (method) => ({ ok: method !== "approveChatJoinRequest" }));
    await handleHubAdmissionCallback(callback("yes", requestId), db, first);
    expect((await db.query("SELECT status FROM telegram_hub_join_requests WHERE id=$1", [requestId])).rows[0].status).toBe("approval_pending");
    await db.query("UPDATE telegram_hub_join_requests SET retry_at=now()-interval '1 second' WHERE id=$1", [requestId]);
    const retry = bot(async () => ({ ok: true }));
    await processHubAdmissionDecisions(db, retry);
    expect((await db.query("SELECT status FROM telegram_hub_join_requests WHERE id=$1", [requestId])).rows[0].status).toBe("approved");
    expect((await db.query("SELECT count(*)::int AS count FROM telegram_hub_memberships")).rows[0].count).toBe(1);
  });

  it("reconciles approval already completed by another administrator", async () => {
    await receiveHubJoinRequest(join(107), db, bot(async () => ({ ok: true })));
    const requestId = String((await db.query("SELECT id FROM telegram_hub_join_requests")).rows[0].id);
    const transport = bot(async (method) => method === "getChatMember"
      ? { ok: true, result: { status: "member" } } : { ok: false, error_code: 400 });
    await handleHubAdmissionCallback(callback("yes", requestId), db, transport);
    expect((await db.query("SELECT status FROM telegram_hub_join_requests WHERE id=$1", [requestId])).rows[0].status).toBe("approved");
  });
});
