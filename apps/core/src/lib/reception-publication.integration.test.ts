import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { processNextReceptionPublication, expireReceptionPublicationClaims } from "./reception-publication";
import { saveReceptionApplication } from "./reception-applications";
import { listReceptionApplications, reviewReceptionDelivery } from "./reception-admin";
import { telegramReceptionConfig } from "./config";
import { ensureTestPgcrypto } from "./test-postgres-extensions";

const url = process.env.RECEPTION_TEST_DATABASE_URL;
const schema = `reception_publication_test_${randomUUID().replaceAll("-", "")}`;
const db = new Pool({ connectionString: url, options: `-c search_path=${schema},public`, max: 16 });
const config = { ...telegramReceptionConfig(), publicationsEnabled: true, token: "synthetic", forumChatId: "-100123", topicId: "7" };
const profile = { subject: "miniapp:84", telegramUserId: "84", displayName: "Verified Candidate", firstName: "Verified", lastName: "Candidate", username: "candidate", avatarUrl: null };
const form = { city: "<b>Москва</b>", occupation: "[Мастер](unsafe)", age: 35, publishAge: true };
let actor: string;
let created = false;
const delivered = (id = 12) => new Response(JSON.stringify({ ok: true, result: { message_id: id, chat: { id: -100123 } } }));
const transport = () => vi.fn<typeof fetch>().mockImplementation(async () => delivered());
const delivery = async () => (await db.query("SELECT * FROM reception_application_deliveries")).rows[0];
const save = async (value = form) => {
  const result = await saveReceptionApplication("84", value, false, db, profile);
  await queuePublication(result.application.id);
  return result;
};
const queuePublication = (applicationId: string) => db.query(`INSERT INTO reception_application_deliveries(application_id,kind)
  VALUES ($1,'publication') ON CONFLICT (application_id,kind) DO NOTHING`, [applicationId]);

describe.skipIf(!url)("Reception publication on isolated PostgreSQL", () => {
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/reception_tests") throw new Error("Use isolated local reception_tests");
    await db.query(`CREATE SCHEMA ${schema}`); created = true;
    await ensureTestPgcrypto(db);
    const dir = new URL("../../migrations/", import.meta.url);
    for (const name of readdirSync(dir).filter(n => n.endsWith(".sql")).sort()) await db.query(readFileSync(new URL(name, dir), "utf8"));
    actor = (await db.query("INSERT INTO participants(display_name) VALUES ('Test admin') RETURNING id")).rows[0].id;
    vi.stubEnv("ADMIN_PARTICIPANT_IDS", actor);
  }, 30000);
  beforeEach(async () => { await db.query("TRUNCATE reception_applications CASCADE"); await db.query("DELETE FROM events"); });
  afterAll(async () => { vi.unstubAllEnvs(); if (created) await db.query(`DROP SCHEMA ${schema} CASCADE`); await db.end(); });

  it("publishes plain text from a verified profile, records target and revision, never creates participants", async () => {
    await save(); const send = transport();
    const before = (await db.query("SELECT count(*) FROM participants")).rows;
    expect(await processNextReceptionPublication(db, config, send)).toMatchObject({ status: "delivered" });
    const payload = JSON.parse(String(send.mock.calls[0][1]!.body));
    expect(payload).toEqual({ chat_id: "-100123", message_thread_id: 7, text: "Verified Candidate\n@candidate\nГород: <b>Москва</b>\nРод занятий: [Мастер](unsafe)\nВозраст: 35" });
    expect(await delivery()).toMatchObject({ status: "delivered", delivered_revision: 1, telegram_chat_id: "-100123", telegram_message_id: "12" });
    expect((await db.query("SELECT count(*) FROM participants")).rows).toEqual(before);
  });
  it("keeps both flags independent and publication off by default", async () => {
    await save(); const send = transport();
    expect(await processNextReceptionPublication(db, { ...config, publicationsEnabled: false }, send)).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
  it("does not republish unchanged data and serializes two workers", async () => {
    await save(); const send = transport();
    const results = await Promise.all([processNextReceptionPublication(db, config, send), processNextReceptionPublication(db, config, send)]);
    expect(results.filter(Boolean)).toHaveLength(1); expect(send).toHaveBeenCalledTimes(1);
    await save(); expect(await processNextReceptionPublication(db, config, send)).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("edits the original message on revision change and removes revoked age", async () => {
    await save(); const send = transport(); await processNextReceptionPublication(db, config, send);
    await save({ ...form, city: "Тверь", publishAge: false });
    await processNextReceptionPublication(db, config, send);
    expect(String(send.mock.calls[1][0])).toContain("/editMessageText");
    const payload = JSON.parse(String(send.mock.calls[1][1]!.body));
    expect(payload.message_id).toBe(12); expect(payload.text).not.toContain("Возраст");
    expect(await delivery()).toMatchObject({ delivered_revision: 2, telegram_message_id: "12" });
    const journal = (await listReceptionApplications(actor, db))[0];
    expect(journal.age).toBeNull(); expect(journal.review_text).not.toContain("Возраст");
  });
  it.each(["timeout", "server", "invalid"])("requires review after %s, never retries automatically", async kind => {
    await save(); const send = vi.fn<typeof fetch>().mockImplementation(async () => {
      if (kind === "timeout") throw new Error("sensitive network details");
      return kind === "server" ? new Response(JSON.stringify({ ok: false, error_code: 500 }), { status: 500 }) : new Response("broken");
    });
    expect(await processNextReceptionPublication(db, config, send)).toMatchObject({ status: "needs_review" });
    expect(await processNextReceptionPublication(db, config, send)).toBeNull(); expect(send).toHaveBeenCalledTimes(1);
    expect((await delivery()).error_code).toBe("telegram_unknown");
  });
  it("retries only explicit rejection, honors retry_after", async () => {
    await save(); const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ok: false, error_code: 429, parameters: { retry_after: 120 } }), { status: 429 }));
    expect(await processNextReceptionPublication(db, config, send)).toMatchObject({ status: "pending" });
    const d = await delivery(); expect(d.retry_at.getTime() - Date.now()).toBeGreaterThan(115000);
    expect(await processNextReceptionPublication(db, config, transport())).toBeNull();
    await db.query("UPDATE reception_application_deliveries SET retry_at=now()-interval '1 second'");
    expect(await processNextReceptionPublication(db, config, transport())).toMatchObject({ status: "delivered" });
  });
  it.each([false, true])("recovers an expired claim with attempted marker=%s conservatively", async attempted => {
    await save(); await db.query(`UPDATE reception_application_deliveries SET status='processing', claim_token=$1,
      claimed_at=now()-interval '11 minutes', attempted_at=CASE WHEN $2 THEN now()-interval '11 minutes' ELSE NULL END`, [randomUUID(), attempted]);
    await expireReceptionPublicationClaims(db);
    expect((await delivery()).status).toBe(attempted ? "needs_review" : "pending");
    const send = transport(); await processNextReceptionPublication(db, config, send);
    expect(send).toHaveBeenCalledTimes(attempted ? 0 : 1);
  });
  it("does not expire an active sender and serializes consent withdrawal with sending", async () => {
    await save(); let release!: () => void; let started!: () => void;
    const ready = new Promise<void>(r => { started = r; });
    const wait = new Promise<void>(r => { release = r; });
    const send = vi.fn<typeof fetch>().mockImplementation(async () => { started(); await wait; return delivered(); });
    const publishing = processNextReceptionPublication(db, config, send); await ready;
    await db.query("UPDATE reception_application_deliveries SET claimed_at=now()-interval '11 minutes'");
    await expireReceptionPublicationClaims(db); expect((await delivery()).status).toBe("processing");
    const updating = save({ ...form, publishAge: false });
    release(); await publishing; await updating;
    const edit = transport(); await processNextReceptionPublication(db, config, edit);
    expect(JSON.parse(String(edit.mock.calls[0][1]!.body)).text).not.toContain("Возраст");
  });
  it("requires admin and manual attestation, fences stale forms and audits recovery", async () => {
    const { application } = await save();
    const send = vi.fn<typeof fetch>().mockRejectedValue(new Error("timeout")); await processNextReceptionPublication(db, config, send);
    const d = await delivery();
    await save({ ...form, publishAge: false, city: "Новый город" });
    const journal = (await listReceptionApplications(actor, db))[0];
    expect(journal.review_text).toContain("Москва"); expect(journal.review_text).not.toContain("Возраст");
    expect(journal.age).toBeNull();
    await expect(listReceptionApplications(randomUUID(), db)).rejects.toThrow("forbidden");
    await expect(reviewReceptionDelivery(randomUUID(), { id: application.id, version: d.version, action: "retry", verified: true }, db)).rejects.toThrow("forbidden");
    await expect(reviewReceptionDelivery(actor, { id: application.id, version: d.version, action: "retry", verified: false }, db)).rejects.toThrow("confirmation_required");
    await reviewReceptionDelivery(actor, { id: application.id, version: d.version, action: "inspect", verified: false }, db);
    await reviewReceptionDelivery(actor, { id: application.id, version: d.version, action: "confirm", verified: true, messageId: "99" }, db);
    expect(await delivery()).toMatchObject({ status: "delivered", telegram_message_id: "99", delivered_revision: 1 });
    await expect(reviewReceptionDelivery(actor, { id: application.id, version: d.version, action: "retry", verified: true }, db)).rejects.toThrow("conflict");
    expect((await db.query("SELECT payload->>'action' AS action FROM events ORDER BY id")).rows).toEqual([{ action: "inspect" }, { action: "confirm" }]);
  });
  it("allows a manually verified retry but never creates a new message after ambiguous edit", async () => {
    const { application } = await save(); await processNextReceptionPublication(db, config, transport());
    await save({ ...form, publishAge: false });
    await processNextReceptionPublication(db, config, vi.fn<typeof fetch>().mockRejectedValue(new Error("timeout")));
    const d = await delivery(); await reviewReceptionDelivery(actor, { id: application.id, version: d.version, action: "retry", verified: true }, db);
    const send = transport(); await processNextReceptionPublication(db, config, send);
    expect(String(send.mock.calls[0][0])).toContain("editMessageText"); expect((await delivery()).telegram_message_id).toBe("12");
  });
  it("resolves legacy names only from matching private getChat", async () => {
    const { application } = await saveReceptionApplication("84", form, false, db);
    await queuePublication(application.id);
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { id: 43, type: "private", first_name: "Wrong" } })));
    await processNextReceptionPublication(db, config, send);
    expect(await delivery()).toMatchObject({ status: "pending", error_code: "profile_unavailable", attempts: 0 });
  });
  it("leaves a durable ambiguous claim when Telegram succeeded but the result could not be committed", async () => {
    await save(); const send = transport();
    const failing = { query: db.query.bind(db), connect: async () => {
      const c = await db.connect();
      return { query: async (sql: string, values?: unknown[]) => {
        if (sql.includes("delivered_revision=CASE")) throw new Error("Synthetic result write failure");
        return c.query(sql, values);
      }, release: c.release.bind(c) };
    } } as unknown as Pool;
    await expect(processNextReceptionPublication(failing, config, send)).rejects.toThrow("Synthetic result write failure");
    expect(await delivery()).toMatchObject({ status: "processing", attempted_revision: 1, attempts: 1 });
    await db.query("UPDATE reception_application_deliveries SET claimed_at=now()-interval '11 minutes'");
    await expireReceptionPublicationClaims(db);
    expect((await delivery()).status).toBe("needs_review");
    expect(await processNextReceptionPublication(db, config, send)).toBeNull(); expect(send).toHaveBeenCalledTimes(1);
  });
  it("commits the attempt snapshot before contacting Telegram and omits General topic 1", async () => {
    await save(); const send = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => {
      expect(await delivery()).toMatchObject({ status: "processing", attempted_revision: 1 });
      expect((await delivery()).attempted_at).toBeInstanceOf(Date);
      expect(JSON.parse(String(options!.body))).not.toHaveProperty("message_thread_id");
      return delivered();
    });
    await processNextReceptionPublication(db, { ...config, topicId: "1" }, send); expect(send).toHaveBeenCalledOnce();
  });
  it("treats an already-applied edit as confirmed and preserves the original mapping", async () => {
    await save(); await processNextReceptionPublication(db, config, transport()); await save({ ...form, publishAge: false });
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: message is not modified: specified new message content is exactly the same" }), { status: 400 }));
    expect(await processNextReceptionPublication(db, config, send)).toMatchObject({ status: "delivered" });
    expect(await delivery()).toMatchObject({ delivered_revision: 2, telegram_message_id: "12" });
  });
  it("manually releases an absent initial publication and records that attestation", async () => {
    const { application } = await save();
    await processNextReceptionPublication(db, config, vi.fn<typeof fetch>().mockRejectedValue(new Error("timeout")));
    const d = await delivery();
    await reviewReceptionDelivery(actor, { id: application.id, version: d.version, action: "retry", verified: true }, db);
    const send = transport(); await processNextReceptionPublication(db, config, send);
    expect(String(send.mock.calls[0][0])).toContain("sendMessage");
    expect((await db.query("SELECT payload->>'manuallyVerified' AS verified FROM events")).rows).toEqual([{ verified: "true" }]);
  });
  it("does not silently publish to a changed target after a manual retry", async () => {
    const { application } = await save();
    await processNextReceptionPublication(db, config, vi.fn<typeof fetch>().mockRejectedValue(new Error("timeout")));
    const d = await delivery();
    await reviewReceptionDelivery(actor, { id: application.id, version: d.version, action: "retry", verified: true }, db);
    const send = transport(); await processNextReceptionPublication(db, { ...config, topicId: "8" }, send);
    expect(await delivery()).toMatchObject({ status: "needs_review", error_code: "target_changed" }); expect(send).not.toHaveBeenCalled();
  });
  it("obtains legacy display names from Telegram without overwriting Core profiles", async () => {
    const { application } = await saveReceptionApplication("84", form, false, db);
    await queuePublication(application.id);
    const send = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: { id: 84, type: "private", first_name: "Trusted", username: "trusted" } })))
      .mockImplementationOnce(async () => delivered());
    await processNextReceptionPublication(db, config, send);
    expect(String(send.mock.calls[0][0])).toContain("getChat");
    expect(JSON.parse(String(send.mock.calls[1][1]!.body)).text).toContain("Trusted\n@trusted");
  });
});
